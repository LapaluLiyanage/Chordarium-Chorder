# The hybrid deployment (what is actually running)

```
browser ─> Vercel: chordarium (static client)
              │  /api/* rewrite
              ▼
        Render (free, Singapore): chordarium-api ──┐
                                                   ├──> Supabase Postgres (Singapore, schema "chordarium")
        Your PC (Docker): analysis worker ─────────┘
```

| Part | Where | Cost | Notes |
|---|---|---|---|
| Web client | Vercel project `chordarium` (root `client`) | free | `client/vercel.json` forwards `/api` to Render |
| API | Render free web service `chordarium-api`, built from `Dockerfile.api` | free | Sleeps after ~15 min idle; the first request after that takes ~50 s |
| Database | Supabase project `chordarium` (ap-southeast-1) | free | Role `chordarium` owns its own schema; paused by Supabase after 7 days with no activity |
| Worker | Your PC, `docker-compose.worker.yml` | free | New analyses run only while it is up |

Why the worker is on your PC: it needs about 2 GB of memory and YouTube blocks most cloud addresses, so analysing from
home is both cheaper and more reliable. Songs already analysed stay viewable even when the PC is off; new links just
wait in the queue until the worker is back.

## Start and stop the worker

```bash
docker compose -f docker-compose.worker.yml up -d --build    # start (needs .env.worker, see below)
docker compose -f docker-compose.worker.yml logs -f worker   # watch an analysis
docker compose -f docker-compose.worker.yml down             # stop
```

`.env.worker` (gitignored) holds one line, the database connection string:

```
DATABASE_URL=postgresql://chordarium.<project-ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

Use the **session pooler** address (host `aws-0-…pooler.supabase.com`, port 5432). The direct `db.<ref>.supabase.co`
address is IPv6-only on Supabase's free plan, which Render and many home connections cannot reach.

## Changing the password

Supabase dashboard → project `chordarium` → SQL editor: `alter role chordarium with password 'NEW';` Then update
`DATABASE_URL` in the Render service's environment and in `.env.worker`, and restart both.

## Public access and limits

The site has no login. To protect your worker, the API refuses new analyses once 8 are waiting or running
(`CHORDARIUM_MAX_ACTIVE_JOBS` on the Render service) and the downloader rejects videos over 15 minutes. If it gets
abused, the quickest stop is to `docker compose -f docker-compose.worker.yml down` (nothing new gets analysed) or to
suspend the Render service.

## Custom subdomain

Vercel → Project `chordarium` → Settings → Domains → add `chords.yourdomain.com`, then add the `CNAME` record Vercel
shows at your DNS provider.
