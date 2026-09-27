# Chordarium

Paste a YouTube link, get the song's chords — including 7ths, extensions, sus
chords and inversions — synced to the video, editable, and exportable as a
chord sheet (ChordPro, PDF, TXT, MIDI, JSON).

**Status:** Phase 1 complete. Backend now runs on Postgres with a
separate worker process (no hosting yet — that's next). See
[`docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md`](docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md).

## Stack

- **Server:** Flask API (request handling only), a separate worker process
  (`server/worker.py`) for the analysis pipeline, yt-dlp + ffmpeg, Demucs
  (stem separation), beat_this (beats), BTC transformer (large-vocabulary
  chord recognition) with a 144-template chroma fallback, Postgres.
- **Client:** React + Vite + TypeScript, YouTube IFrame player.

## Roadmap

1. **Phase 1** — local Flask + React app: analyze, synced tracker, chord
   editor, exports.
2. **Phase 2** — public web platform to publish and share chord sheets.

## Run the server (Phase 1)

```powershell
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python scripts/setup_models.py      # BTC chord model (one time)
docker compose up -d                # local Postgres on localhost:5433
python -m pytest                    # fast tests; add -m "slow or not slow" for model tests
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5433/chordarium"
python -m server.app                # API on http://127.0.0.1:5000
```

Requires ffmpeg on PATH. Requires a local Postgres: `docker compose up -d`
(or point `DATABASE_URL` at your own for the app/worker). Run the worker in
a second terminal: `python -m server.worker`. Tests use their own dedicated
database (`chordarium_test` on the same server, auto-created on first run)
and never touch `DATABASE_URL` — running the suite is always safe even if
`DATABASE_URL` points at a real dev or production database elsewhere.

## Run the app (Phase 1)

Terminal 1 — API:
```powershell
.venv\Scripts\activate
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5433/chordarium"
python -m server.app
```

Terminal 2 — worker (runs the analysis pipeline):
```powershell
.venv\Scripts\activate
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5433/chordarium"
python -m server.worker
```

Terminal 3 — web client:
```powershell
cd client
npm install
npm run dev          # http://localhost:5173
npm test             # client tests
```
