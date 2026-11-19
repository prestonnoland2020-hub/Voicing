# Voicing

Hear a song, learn it the way it was recorded: capo, tuning, the exact chord shapes, and the picked notes between them. Plus a guitar tuner.

Live: https://prestonnoland2020-hub.github.io/Voicing/

Everything runs on the phone in the browser. No account, no server, nothing uploaded.

## Layout

- `src/engine.js`: the listening engine (chords, voicings, capo, tuning, tempo, beats, picked notes) and the tuner's pitch code.
- `src/app.html`: the screens. `src/head.html`: icons and Home Screen setup.
- `build.js`: builds `index.html` (the live page) and `version.json`. The version (for example `1.5.0+d6de2ce`) shows at the bottom of the home screen.
- `tests/`: the test suite (below). `docs/NEXT-LEVEL.md`: options for going further (stem separation, a trained model, a server) with costs.

## Making a change

1. Edit `src/`, then run `node build.js`.
2. Run `npm test` (needs `npm install` once, and Chrome).
3. Push. GitHub runs every test on every push (Actions tab, "Tests"). After Pages publishes, "Live site check" opens the live site, checks it serves the new version, and plays the demo.

## Tests

- `tests/tuner.test.js`: all six strings, in tune and 3 to 30 cents sharp and flat, at 44.1 and 48 kHz, with a clean tone and real recorded acoustic, nylon and electric guitar.
- `tests/engine.test.js`: the demo reads back exactly; silence, noise, short and clipped audio don't break it.
- `tests/accuracy.js`: 36 songs (20 for tuning, 16 held out) with known chords, shapes, capo, tuning, tempo and licks, in five mixes: clean, with a band, through a phone mic, real recorded guitar, real guitar with a band. Scores each against a target and against `tests/baseline.json`. The push fails if any score drops more than 2 points. Run `node tests/accuracy.js --update-baseline` after a real improvement.
- `tests/ui.test.js`: every screen at iPhone SE, 15 and 15 Pro Max sizes (no sideways scroll, nothing off screen, no overlapping or too-small buttons), the full tap-through, the tuner and listening flows with a fake microphone, a refused microphone, and the problem log.
- `tests/live.check.js`: the live-site check.

## Problem log

The app keeps its last 30 errors on the phone (home screen, "Problem log"). It is never sent anywhere; "Copy log" copies it to share by hand.

## Credits

Real guitar recordings in `tests/samples/` are from tonejs-instruments (CC-BY 3.0); see `tests/samples/CREDITS.md`.
