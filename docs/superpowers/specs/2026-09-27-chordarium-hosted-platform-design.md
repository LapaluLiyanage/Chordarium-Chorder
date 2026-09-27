# Chordarium — Hosted Platform Design (Phase 1 + Phase 2 combined)

Date: 2026-09-27 · Status: §4 and most of §6 implemented (see
[2026-09-27-chordarium-client-side-edits.md](../plans/2026-09-27-chordarium-client-side-edits.md));
§3, §5, §7's dedupe test, and §9 are not yet built — that's Plan 2.
Supersedes the phasing in [`2026-09-26-chordarium-design.md`](2026-09-26-chordarium-design.md)
§1 ("Out of scope: public hosting... Phase 2: separate spec later"). That
spec's engine, theory, and export design (§3, §6) are unchanged and still
apply; this document covers what changes to make the app one hosted,
public product instead of a local app plus a separate future platform.

## 1. Goal

Ship Chordarium as a single hosted web app that both analyzes YouTube
links into chord sheets *and* lets anyone browse/share the results — no
local install, no accounts. Analyzing a song contributes it to a shared
public library that anyone can find and open by link.

**Success criteria**

- A first-time visitor can paste a YouTube link on the hosted site and get
  a synced, editable chord timeline, with no setup step (no local helper,
  no login).
- A song analyzed once is instantly available (from cache) to every later
  visitor who requests the same video — no repeat download.
- A song's tracker page (`/songs/:id`) is a stable, shareable URL.
- Chord corrections a visitor makes never affect what other visitors see.

**Out of scope for this pass:** user accounts, per-user ownership or
moderation, proxy rotation for ingestion, server-side library search,
changes to the analysis engine, chord theory, or export logic (only
*where* the pipeline runs changes, not what it does).

## 2. Why this replaces the original Phase 2 plan

The original spec (§1) deferred public hosting specifically because
server-side YouTube downloading breaches YouTube's ToS and gets
IP-blocked, and proposed revisiting ingestion (e.g. user upload) later.
This design accepts that risk deliberately rather than avoiding it:

- Existing public products (e.g. Chordify) operate on exactly this
  paste-a-link-and-analyze model at scale over years, showing it's
  operationally viable, not just theoretical.
- The **cache-once** behavior already implied by `POST /api/analyze`
  (§4 of the original spec: "returns cached `song_id` if the video was
  analyzed before") is the main mitigation: a given video is downloaded
  at most once, ever, regardless of how many visitors request it.
- A local helper approach (e.g. the same pattern as the separate
  ClipForge project, which runs `yt-dlp`/ffmpeg on the user's own machine
  to sidestep this exact risk) was considered and rejected: it requires
  a local install, which conflicts with the "no setup step" goal here.
- Residential/rotating proxies for the download step are a valid future
  hardening if blocking becomes frequent in practice, but are not built
  now — added only if needed.

## 3. Ingestion & the shared library

Reuse the existing `server/engine/ingest.py` (yt-dlp → ffmpeg → mono WAV)
and `pipeline.py` unchanged, running server-side in the hosted worker
(§5) instead of on a local machine. `POST /api/analyze` keeps its
existing cache-by-`video_id` check unchanged.

The `songs` table (existing schema, §4 of the original spec) becomes the
**shared public library**: every analysis any visitor triggers is stored
once and is visible to every other visitor via `GET /api/songs` and
`GET /api/songs/<id>`. There is no per-user or per-session partitioning
of this data — it is a single shared, global library, matching the "no
accounts" decision (§4 below).

## 4. Edits become client-side only (behavior change from Phase 1)

**This is the one real behavior change**, not just a relocation. Today,
`PUT /api/songs/<id>/segments/<idx>` and `POST /api/songs/<id>/reset`
mutate the single shared row in `store.py` — correct for a local,
single-user app, but wrong once the library is shared: one visitor's
correction would silently overwrite what every other visitor sees.

Changes:

- `GET /api/songs/<id>` always returns the pristine, as-analyzed
  timeline. It is never mutated by user edits.
- `PUT /api/songs/<id>/segments/<idx>` and `POST /api/songs/<id>/reset`
  are **removed** from the server (not migrated) — the mutation logic in
  `store.py` (`update_segment`, `reset_song` and their backing columns
  `original_json` vs. `timeline_json`) goes away along with them, since
  there is only one canonical copy per song now.
- The client's existing `useViewSettings` hook already persists
  transpose/capo/simplify per song in `localStorage`. Chord-label
  corrections are held the same way, but in a separate hook
  (`useChordOverrides`) rather than folded into `useViewSettings` — a
  deviation from this section's original wording, made during Plan 1's
  implementation for cleaner separation of concerns (edits vs. view
  settings are different lifecycles: edits key off segment index and
  need merge/apply logic; view settings are flat and never merge). The
  Tracker page, Chord Editor, and all exports read the *merged* view
  (canonical timeline + local overlay) exactly as they read the merged
  view today for transpose/capo/simplify.
- "Reset" is purely client-side: clears that song's local overlay. It
  never calls the server.

**Implemented** (Plan 1, merged): server-side mutation removed, exports
switched to POST-with-timeline, `useChordOverrides` added.

## 5. Hosting architecture (Render + Vercel)

Backend on Render (two services sharing one database, replacing the
single local Flask process + SQLite + in-process `ThreadPoolExecutor`);
static frontend on Vercel.

**Frontend (Vercel):** the Vite production build (`client/dist`) deployed
as a static Vercel project. `client/vercel.json` adds a rewrite so the
browser's existing relative `/api/*` calls (unchanged from local dev,
`client/src/api.ts`) transparently proxy to the Render web service:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<render-web-service>.onrender.com/api/:path*" }
  ]
}
```

This is chosen over CORS + an absolute API base URL because it needs no
client code change (still same-origin from the browser's perspective),
doesn't expose the Render service's URL directly, and avoids CORS
preflight overhead on every request. No `CHORDARIUM_API_URL`-style env
var is needed in the client build.

**Backend (Render):**

- **Web service** (Flask API, existing `server/app.py` routes minus the
  edit/reset routes removed in §4): handles all HTTP routes, reads/writes
  the database, and enqueues analyze jobs. It never runs Demucs/BTC
  itself, so it stays responsive regardless of how long an analysis
  takes.
- **Background worker**: a separate Render service running the existing
  `jobs.py` / `pipeline.py` logic (ingest → separate → beats → chords →
  bass → key), polling the `jobs` table for `queued` work instead of the
  current in-process thread pool. This isolates heavy CPU work (Demucs,
  BTC) from request handling — a slow analysis never blocks another
  visitor's page load.
- **Managed Postgres** replaces SQLite. Render's web/worker filesystems
  are ephemeral across deploys and are not shared between the two
  services, but both need to read/write the same `songs` and `jobs`
  tables, so a real shared database is required. Same schema as the
  original spec §4, with `timeline_json`/`original_json`-equivalent
  columns as JSON/JSONB (only `timeline_json` is still needed per §4 of
  this document — `original_json` may be dropped along with the
  edit/reset routes it existed to support, since there is no longer a
  distinct "edited" copy stored server-side).
- **BTC model weights**: downloaded once during the worker's build step
  via the existing `scripts/setup_models.py`, cached across deploys by
  Render's build cache rather than re-downloaded on every deploy.
- Audio files remain temporary and are deleted after each job completes
  (existing config flag, unchanged) — no persistent audio storage needed.

Job states (`queued → downloading → separating → beats → chords → bass →
key → done | failed`) are unchanged from the original spec §3 — only the
process consuming them changes, from a thread pool to a polling worker.

## 6. Frontend

No new route or page is needed. [`HomePage.tsx`](../../../client/src/pages/HomePage.tsx)
already renders a "Recent songs" list from `GET /api/songs` (thumbnail,
title, key, tempo) linking to each song's existing shareable
`/songs/:id` route — this becomes the public library view automatically
once the backend behaves per §3, with two small changes:

- Add a client-side title filter (a text input filtering the
  already-fetched `songs` array in memory; library size doesn't
  currently warrant a server-side search endpoint). **Implemented.**
- Remove the "Public library · coming soon" badge in
  [`App.tsx`](../../../client/src/App.tsx) — it is no longer coming
  soon. **Implemented.**
- Add `useChordOverrides` (§4) to own chord-label overlay edits.
  **Implemented** (as its own hook, not folded into `useViewSettings` —
  see §4).
- Remove any client code paths that call the now-deleted
  `PUT /api/songs/<id>/segments/<idx>` / `POST /api/songs/<id>/reset`
  endpoints, replacing them with the local-overlay equivalent.
  **Implemented.**
- Deploy the client to Vercel with the rewrite proxy in §5. **Not yet
  built** — Plan 1 only changed app behavior, not where it's hosted.

## 7. Errors & edge cases

Unchanged from the original spec §7, with one addition:

| Case | Behaviour |
|---|---|
| Two visitors submit the same new (uncached) URL concurrently | Second request's job is coalesced with the first (dedupe on `video_id` at enqueue time in the web service), rather than downloading/analyzing twice. |

## 8. Testing

Existing test coverage (original spec §8) stays valid for the engine,
theory, and export layers unchanged by this document. New/changed
coverage needed:

- **pytest — API:** `edit_segment`/`reset_song` route tests removed
  along with the routes; a test that `GET /api/songs/<id>` returns
  an identical payload before and after a client would have "edited" it
  (i.e. confirms no server-side mutation path remains reachable).
  **Implemented.**
- **pytest — API:** concurrent-duplicate-URL enqueue test (§7) confirms
  a single job/download per `video_id`. **Already existed** before this
  spec (`test_analyze_twice_reuses_running_job`) — not new work.
- **Vitest — client:** `useChordOverrides` tests cover chord-label
  corrections merging with the canonical timeline (single edit,
  apply-to-all, reset, persistence per song, storage-throws,
  invalid-label). **Implemented.**
- **Manual:** verify the worker process can be started/stopped
  independently of the web service against a shared Postgres instance
  (local docker-compose or two local processes pointed at one DB, before
  first Render deploy). **Not yet built.**
- **Manual:** verify the Vercel rewrite actually proxies `/api/*` to the
  Render service in a deployed preview, not just in local dev where
  Vite's own dev-server proxy handles it. **Not yet built.**

## 9. Setup / deployment constraints

In addition to the original spec §9 (Python 3.12 venv, ffmpeg on PATH,
BTC weights):

- Two Render services (web, worker) plus one managed Postgres instance.
- `DATABASE_URL` env var shared by both services; SQLite-specific code in
  `store.py` is replaced with a Postgres-compatible data layer.
- Worker's build step runs `scripts/setup_models.py`; Render build cache
  configured to persist the downloaded weights across deploys.
- One Vercel project for `client/`, with `client/vercel.json`'s rewrite
  (§5) pointing at the Render web service's URL. No new client env vars.
