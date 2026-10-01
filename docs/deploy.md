# Running Chordarium on a machine you control

This runs the whole app (database, API, analysis worker and web client) with Docker. It is set up for **private
use**: the web app listens on this machine only unless you change that.

## First run

```bash
cp .env.example .env            # then edit .env and set POSTGRES_PASSWORD (letters and digits only)
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes a while (it downloads PyTorch, the chord model and the web build tools) and the server image
is a few gigabytes. Open http://127.0.0.1:8080 when it finishes.

| Service | What it does |
|---|---|
| `web` | nginx serving the built client; forwards `/api` to `api` |
| `api` | Flask API under gunicorn (never touches audio) |
| `worker` | downloads audio and runs the analysis; one analysis at a time per worker |
| `postgres` | songs and jobs; not reachable from outside the containers |

The first analysis downloads the beat-tracking model (about 77 MB), and the first **Accurate** analysis also downloads
the Demucs model (about 80 MB). Both go into the `torch-cache` volume, so later runs reuse them. This needs internet
access once; after that analyses only need it to fetch the video.

## Everyday commands

```bash
docker compose -f docker-compose.prod.yml ps                 # is everything up?
docker compose -f docker-compose.prod.yml logs -f worker     # watch an analysis
docker compose -f docker-compose.prod.yml up -d --build      # update after pulling new code
docker compose -f docker-compose.prod.yml down               # stop (data is kept)
```

## Backups

Songs live in the `postgres-data` volume. A backup is one command:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U chordarium chordarium > chordarium-backup.sql
# restore into a fresh install:
docker compose -f docker-compose.prod.yml exec -T postgres psql -U chordarium chordarium < chordarium-backup.sql
```

Your chord edits, favourites and "continue practising" progress are stored in each browser, not in the database.

## Reaching it from other devices

- **Same home network:** set `WEB_BIND=0.0.0.0` in `.env` and open `http://<this-machine's-ip>:8080`. There is no
  login, so anyone on that network can use it.
- **From anywhere, privately:** put the machine on a private network such as Tailscale and keep `WEB_BIND` at
  `127.0.0.1`, publishing it through the VPN. Do not forward port 8080 to the open internet: there is no
  authentication, and a public service that downloads YouTube audio may breach YouTube's terms.

## Troubleshooting

- **"Couldn't download this video"** usually clears if you try again in a minute. If it keeps happening, rebuild so
  yt-dlp updates: `docker compose -f docker-compose.prod.yml build --no-cache worker api && docker compose -f docker-compose.prod.yml up -d`.
- **The first analysis is slow:** models load on first use. Quick mode takes about 30 seconds afterwards.
- **Port 8080 is taken:** set `WEB_PORT` in `.env`.
- **Change the owner printed in PDFs:** set `CHORDARIUM_PDF_OWNER` in `.env`, then `up -d`.
