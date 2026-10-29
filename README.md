# Chordarium Chorder

Paste a YouTube link, get the song's chords — including 7ths, extensions, sus
chords and inversions — synced to the video, editable, and exportable as a
chord sheet (ChordPro, PDF, TXT, MIDI, JSON).

![Chordarium Chorder home page](docs/screenshots/home.jpg)

![Chordarium Chorder tracker: video, current chord, section strip and beat ruler](docs/screenshots/tracker.jpg)

## Features

- **Any YouTube song:** paste a link and get chords in time with the video.
- **Rich chords:** 7ths, extensions, sus chords, inversions and slash-chord bass notes.
- **Song sections:** bar-aligned Intro, Verse, Chorus, Bridge, Interlude and Outro.
- **Practice tools:** loop a section, slow it down, follow the beat ruler and chord wheel.
- **Editable:** fix chords and rename or move sections in edit mode.
- **Export:** ChordPro, PDF lead sheet, TXT, MIDI and JSON.
- **Library:** analysed songs are kept, with favourites and progress saved in your browser.

## Quick start

### With Docker (private use)

```bash
cp .env.example .env        # set POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
```

Then open http://127.0.0.1:8080. This runs the database, API, worker and web
client together and listens on this machine only. See
[`docs/deploy.md`](docs/deploy.md) for backups, reaching it from other devices
and troubleshooting. For hosting options see
[`docs/deploy-render-vercel.md`](docs/deploy-render-vercel.md) and
[`docs/deploy-hybrid.md`](docs/deploy-hybrid.md).

### For development

Requires Python 3.12, Node.js, ffmpeg on PATH and a local Postgres.

```powershell
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python scripts/setup_models.py      # BTC chord model (one time)
docker compose up -d                # local Postgres on localhost:5433
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5433/chordarium"
```

Then run three processes, each in its own terminal:

```powershell
python -m server.app        # API on http://127.0.0.1:5000
python -m server.worker     # analysis pipeline worker
cd client; npm install; npm run dev   # web client (Vite)
```

Tests: `python -m pytest` (fast tests; add `-m "slow or not slow"` for model
tests) and `npm test` in `client/`. The Python tests use their own database
(`chordarium_test`, created automatically) and never touch `DATABASE_URL`, so
running them is always safe.

## Song sections and accuracy

Songs are split into bar-aligned sections using bar-level similarity of chroma
and timbre; sections that sound alike are grouped, and repetition, loudness and
(in Accurate mode) the vocal stem decide the names. Exports group bars under
these headings. Bass notes of slash chords are drawn in their own colour
(toggle in the controls).

Everything is detected automatically and can be wrong. Quick mode has no vocal
stem, so its section labels are weaker guesses (shown with `?`); Accurate mode
is slower but better for bass notes and sections. Loop-based songs get rougher
sections. Sections can be renamed or moved in edit mode, and older songs can be
re-analyzed from the tracker page (this discards local edits).

## Stack

- **Server:** Flask API (request handling only), a separate worker process
  (`server/worker.py`) for the analysis pipeline, yt-dlp + ffmpeg, Demucs
  (stem separation), beat_this (beats), BTC transformer (large-vocabulary
  chord recognition) with a 144-template chroma fallback, Postgres. See
  [`docs/chord-recognition-model.md`](docs/chord-recognition-model.md) for how
  chords are recognised.
- **Client:** React + Vite + TypeScript, YouTube IFrame player, GSAP motion.

## Roadmap

1. **Phase 1 (done)** — Flask + React app on Postgres with a separate worker:
   analyze, synced tracker, chord editor, exports.
2. **Phase 2** — public web platform to publish and share chord sheets.
