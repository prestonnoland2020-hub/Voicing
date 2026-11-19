# Guitar splitter (optional)

A small server that takes a song and sends back the guitar on its own, so Voicing can read licks and shapes with a full band playing. It runs Demucs `htdemucs_6s` on a Modal GPU, paid per second.

Until it's deployed and its address is in `server/split-url.txt`, the app hides the switch and nothing leaves the phone.

## Cost guards (in `modal_app.py`)

- Only the first 150 seconds of a song are processed.
- At most 2 GPUs at once; the GPU turns off 60 seconds after the last song.
- At most 100 songs a day in total (`VOICING_DAILY_CAP`); after that it answers "daily limit reached".
- Only requests from the Voicing site are accepted from browsers.

Roughly 1 to 1.5 cents of GPU per song (T4). Set a spending limit in Modal's billing settings as well.

## Deploy

```
pip install modal
modal setup
modal deploy server/modal_app.py
```

`modal deploy` prints an address ending in `.modal.run`. Put that one line in `server/split-url.txt`, run `node build.js`, and push.

## Check it

```
curl https://YOUR-ADDRESS.modal.run/health
```

The first song after a quiet spell takes longer (the GPU starts up and loads the model).
