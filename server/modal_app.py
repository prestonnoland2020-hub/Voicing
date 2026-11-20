"""Voicing guitar splitter: takes a song, hands back the guitar on its own.

Runs Demucs (htdemucs_6s, the open-source model with a separate guitar track) on a Modal GPU,
billed per second. Deploy: `modal deploy server/modal_app.py` (see server/README.md).

Cost guards: only the first 150 seconds of a song are processed, at most 2 GPUs at once,
the GPU shuts off 60 s after the last song, and a daily cap (DAILY_CAP) refuses work past it.
"""
import io
import os
import time

import modal

DAILY_CAP = int(os.environ.get("VOICING_DAILY_CAP", "100"))  # songs per day, across everyone
MAX_SECONDS = 150
ALLOWED_ORIGINS = ["https://preston-noland.github.io", "https://prestonnoland2020-hub.github.io"]

app = modal.App("voicing-splitter")
counts = modal.Dict.from_name("voicing-splitter-counts", create_if_missing=True)


def _download_model():
    from demucs.pretrained import get_model

    get_model("htdemucs_6s")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch==2.3.1",
        "torchaudio==2.3.1",
        "demucs==4.0.1",
        "numpy<2",
        "soundfile==0.12.1",
        "fastapi[standard]==0.115.6",
    )
    .run_function(_download_model)
)


@app.cls(gpu="T4", image=image, scaledown_window=60, max_containers=2, timeout=300)
class Splitter:
    @modal.enter()
    def load(self):
        import torch
        from demucs.pretrained import get_model

        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = get_model("htdemucs_6s").to(self.device).eval()

    def split(self, data: bytes) -> bytes:
        """Audio file bytes in (any format ffmpeg reads), guitar WAV out: mono, 22,050 Hz, 16-bit."""
        import subprocess

        import numpy as np
        import soundfile as sf
        import torch
        from demucs.apply import apply_model

        sr = self.model.samplerate
        pcm = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", "pipe:0", "-t", str(MAX_SECONDS), "-f", "f32le", "-ac", "2", "-ar", str(sr), "pipe:1"],
            input=data, capture_output=True, check=True,
        ).stdout
        wav = torch.from_numpy(np.frombuffer(pcm, dtype=np.float32).reshape(-1, 2).T.copy())
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            out = apply_model(self.model, wav[None].to(self.device), split=True, overlap=0.25, progress=False)[0]
        guitar = out[self.model.sources.index("guitar")].mean(0).cpu().numpy()
        # back to 22,050 Hz mono, the rate the app analyses at
        g22 = subprocess.run(
            ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", "-ar", "22050", "-f", "f32le", "pipe:1"],
            input=guitar.astype(np.float32).tobytes(), capture_output=True, check=True,
        ).stdout
        g = np.frombuffer(g22, dtype=np.float32)
        peak = float(np.abs(g).max()) or 1.0
        buf = io.BytesIO()
        sf.write(buf, (g / peak * 0.9).astype(np.float32), 22050, subtype="PCM_16", format="WAV")
        return buf.getvalue()

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, Request, Response
        from fastapi.middleware.cors import CORSMiddleware

        api = FastAPI()
        api.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["POST", "GET"], allow_headers=["*"])

        @api.get("/health")
        def health():
            return {"ok": True, "model": "htdemucs_6s"}

        @api.post("/split")
        async def split(request: Request):
            origin = request.headers.get("origin", "")
            if origin and origin not in ALLOWED_ORIGINS:
                return Response("origin not allowed", status_code=403)
            day = time.strftime("%Y-%m-%d")
            n = counts.get(day, 0)
            if n >= DAILY_CAP:
                return Response("daily limit reached", status_code=429)
            data = await request.body()
            if not data or len(data) > 25_000_000:
                return Response("send an audio file up to 25 MB", status_code=413)
            counts[day] = n + 1
            try:
                return Response(self.split(data), media_type="audio/wav")
            except Exception as e:  # unreadable audio and the like
                return Response(f"could not split: {type(e).__name__}", status_code=422)

        return api
