# Deploying on Render (backend) and Vercel (web client)

`render.yaml` and `client/vercel.json` in this repo describe both halves. Nothing here is live until you create the
projects below: it needs your Render and Vercel accounts.

```
browser ──> Vercel (static client)  ── /api/* rewrite ──>  Render: chordarium-api ──> Render Postgres
                                                           Render: chordarium-worker ──┘
```

## 1. Render (API, worker, database)

1. Push this repo to GitHub (it is already at `LapaluLiyanage/Chordarium`).
2. Render dashboard → **New → Blueprint** → pick the repo. Render reads `render.yaml` and proposes three things:
   `chordarium-db` (Postgres), `chordarium-api` (web service) and `chordarium-worker` (background worker).
3. Approve. The first build is slow (about 10–15 minutes: PyTorch and the chord model are downloaded).
4. When it is live, open `https://chordarium-api.onrender.com/api/songs`. You should see `[]`.
   If Render gave your API a different name (for example `chordarium-api-x1y2`), note the real URL for step 2.

Sizes and cost (check Render's current pricing): the worker is set to **standard (2 GB)**, which runs Quick mode.
**Accurate** mode separates stems with Demucs and needs about 4 GB or more: change `plan: standard` to `pro` for the
worker. The API is light and runs on `starter`.

## 2. Vercel (web client)

1. Vercel → **Add New → Project** → import the same repo.
2. Set **Root Directory** to `client`. Vercel reads `client/vercel.json`: Vite build, `dist` output.
3. Open `client/vercel.json` and make sure the first rewrite points at **your** API URL from Render step 4
   (the file assumes `https://chordarium-api.onrender.com`). Commit the change if you edit it.
4. Deploy. Then open the Vercel URL, paste a link, and analyze a song.

Add the subdomain under Vercel → Project → **Settings → Domains** (for example `chords.yourdomain.com`), and create the
`CNAME` record Vercel shows at your DNS provider.

## Read this before sharing the URL

- **There is no login.** Anyone who finds the address can queue analyses, and each one uses your worker and bandwidth.
  Keep the URL private, or add protection first (Vercel password protection needs a paid plan; Cloudflare Access in
  front of your domain also works).
- **YouTube may block downloads from Render.** Cloud servers share data-centre addresses that YouTube often refuses,
  so analyses can fail with "Couldn't download this video" even though the app is fine. Running the stack on your own
  machine (see `deploy.md`) avoids this.
- **Free instances sleep and have no disk.** The worker keeps its models only until it restarts, then downloads them
  again (about 150 MB), so the first analysis after a restart is slower.
- **Public hosting of a downloader** may go against YouTube's terms. Prefer private use, or support uploading your own
  audio before opening it to others.
