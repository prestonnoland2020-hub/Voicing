# Voicing: the next level

Where the free, in-phone version stands, and what it would take to go further. Nothing here has been set up or paid for.

## Where it stands (tests in this repo, run on every push)

- **Chords, capo, tuning, tempo:** good. On real recorded guitar it reads about 9 in 10 chords right, and capo and tuning almost always.
- **Exact voicing (which shape):** good alone, weaker with a band (about 7 in 10).
- **Picked notes between chords (licks/tab):** the weak spot. About 7 to 8 in 10 on guitar alone, about 3 to 4 in 10 once drums and bass play.
- **Why:** everything runs in the phone's browser with hand-built signal processing. Drums and bass land on the same frequencies as the guitar, and there's no way to pull them apart without a trained model.

## Option 1: guitar stem separation (biggest single gain for licks with a band)

Split the song into guitar / bass / drums / vocals first, then run the current analysis on the guitar stem only.

- **Model:** Demucs `htdemucs_6s` (open source, MIT). It's the widely used model with a separate guitar stem.
- **Speed (vendor-reported, Nov 2026):** about 10 to 15 seconds for a 3-minute song on a gaming-class GPU, 40 to 60 seconds on an A40. On a phone CPU it would be minutes, so it needs a server.
- **Where to run it:** a pay-per-second GPU service such as Modal. Reported rates (Oct 2026): T4 about $0.59/hr, L4 about $0.80/hr. A minute of GPU per song is about 1 to 1.5 cents. Modal's starter plan includes $30/month of compute, which covers roughly 2,000+ songs a month.
- **Effort:** about 2 to 4 days. A small Python service (upload audio, return the guitar stem), the app sends the recording there, then a test run on the band mixes in this repo.
- **Costs beyond money:** songs leave the phone (privacy note needed in the app), it needs an internet connection, and it adds 15 to 60 seconds of waiting.
- **Needs from you:** an account on the GPU service and a card on file, even if usage stays inside the free credit.

## Option 2: a trained note/tab model (best accuracy for picked notes)

Replace the hand-built note detector with a model trained on real guitar recordings with tab labels.

- **Starting points:** Spotify's Basic Pitch (open source, small, can run in the browser) for notes; research tab models trained on GuitarSet for string and fret.
- **Effort:** Basic Pitch in the browser: about 3 to 5 days, no server, no running cost. A custom tab model: 2 to 4 weeks plus GPU training time (tens of dollars).
- **Trade-off:** Basic Pitch alone still struggles with drums, so it works best combined with option 1.

## Option 3: server hosting for the whole analysis

Move all analysis to a server: faster on old phones and lets heavier models run.

- **Effort:** about 1 week. **Cost:** the same per-song GPU cost as option 1 plus a small always-on server (about $5 to $20/month), or nothing extra if it runs entirely on the pay-per-second service.
- **Trade-off:** the app stops working offline.

## Recommendation

1. Add Basic Pitch in the browser first (free, private, no account).
2. Then add stem separation for songs with a full band, behind a "Better accuracy (uses the internet)" switch.
3. Keep the tests in this repo as the scoreboard: each step has to raise the band-mix lick score without lowering anything else.

## Sources

- Modal rates and starter credit: https://dupple.com/learn/modal-pricing (read Nov 2026)
- Demucs speed and model notes: https://docs.clore.ai/guides/audio-and-voice/demucs-separation and https://dev.to/codesugar_lin_037a57b06a4/htdemucs-vs-bs-roformer-vs-spleeter-a-2026-audio-source-separation-benchmark-2ll8
