# Postgres Migration + Worker Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite + the in-process `ThreadPoolExecutor` job runner with
Postgres + a standalone polling worker process, so the web service and the
heavy analysis pipeline can run as two separate Render services sharing one
database — without yet touching Render or Vercel themselves.

**Architecture:** `server/store.py` moves from `sqlite3` to `psycopg` (v3)
against a real Postgres database, gains a `cancel_requested` column and two
new methods (`claim_next_job` using `FOR UPDATE SKIP LOCKED` so multiple
workers can never double-claim a job, and `request_cancel` for cross-process
cancellation). A new `server/worker.py` polls `claim_next_job` in a loop and
runs the existing `pipeline.analyze()` exactly as `JobRunner._run` did,
which it replaces along with all of `server/jobs.py`. `server/app.py` no
longer creates or talks to a `JobRunner` — `/api/analyze` just calls
`store.create_job()`, `/api/jobs/<id>/cancel` just calls
`store.request_cancel()`, and the web service never imports the pipeline or
touches a work directory. A local Postgres via `docker-compose.yml`
backs both the dev server and the test suite.

**Tech Stack:** Flask (Python 3.12), pytest, `psycopg[binary]` (Postgres
driver), Docker (for the local Postgres used by dev + tests).

**Spec:** [docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md](../specs/2026-09-27-chordarium-hosted-platform-design.md)
(§5 "Backend (Render)"). §3's ingestion caching and §7's duplicate-URL dedupe
already exist unchanged in `server/app.py` and need no new work here. This
plan stops at code fully tested against a local Postgres — it does not
create any real Render/Vercel resources or write `render.yaml`/`vercel.json`
(those need the real service URLs Render assigns, so they belong to the
actual deploy session, done together with the person, not this plan).

## Global Constraints

- No SQLite anywhere in `server/` after this plan — Postgres is the only
  backend, for dev, tests, and production alike (per spec §9: "SQLite-specific
  code in `store.py` is replaced with a Postgres-compatible data layer").
- The web service (`server/app.py`) must never import `server.engine.pipeline`
  or anything that imports it — that import chain pulls in librosa/torch/
  Demucs, which is exactly the heavy-CPU work this split is meant to keep off
  the request-handling process.
- `Store`'s public method names and return shapes for existing methods
  (`create_job`, `update_job`, `get_job`, `get_active_job`,
  `fail_interrupted_jobs`, `save_song`, `get_song`, `get_song_by_video`,
  `list_songs`, `delete_song`) do not change — only the storage engine
  underneath them does. Only `claim_next_job` and `request_cancel` are new.
- `pytest` must pass against a real local Postgres (via `docker compose up
  -d`) — no test may fall back to SQLite or an in-memory stand-in.

## Review Focus

- A worker process restarting mid-job must not silently lose that job
  forever — it must end up `failed`, not stuck `downloading`/`chords`/etc.
  forever. This now has to happen in the *worker's* startup, not the web
  app's: restarting the web service no longer kills or touches jobs running
  in the separate worker process, so `fail_interrupted_jobs()` moving out of
  `create_app()` and into `worker.main()` is a real behavior change, not
  just a relocation — tested in Task 4.
- Two workers polling at the same time must never both claim the same
  queued job — tested in Task 2 with real concurrent connections, not a
  single-threaded simulation.
- Cancelling a job that's already `done`/`failed`/`cancelled` must be a
  no-op that leaves it exactly as it was, not resurrect or corrupt it —
  tested in Task 2.
- Cancelling a job that's still `queued` (never claimed by any worker) must
  take effect immediately, since there's no running worker to notice a
  flag — tested in Task 2.
- `/api/analyze` and `/api/jobs/<id>/cancel` must work correctly with zero
  workers running (job just sits `queued` until one polls) — the web
  service must never block waiting for a worker — tested in Task 4.

---

### Task 1: Local Postgres for dev and tests

**Files:**
- Create: `docker-compose.yml`
- Modify: `requirements.txt` (add `psycopg[binary]`)
- Modify: `server/tests/conftest.py` (add a Postgres-backed `store` fixture,
  shared by every test file that needs one)
- Test: `server/tests/test_store_fixture.py` (a throwaway smoke test proving
  the fixture round-trips against a real Postgres; superseded by Task 2's
  real `test_store.py` coverage, deleted at the end of Task 2)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `store` pytest fixture (function-scoped, fresh tables every
  test) that Tasks 2-4's test files consume by name — later tasks must not
  redefine their own `store` fixture.

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_store_fixture.py`:

```python
def test_store_fixture_round_trips(store, timeline):
    song_id = store.save_song(timeline)
    assert store.get_song(song_id)["title"] == "Test Song"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest server/tests/test_store_fixture.py -v`
Expected: FAIL — no `store` fixture is defined yet (`fixture 'store' not found`).

- [ ] **Step 3: Add the Postgres service and fixture**

Create `docker-compose.yml` at the repo root:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: chordarium
      POSTGRES_PASSWORD: chordarium
      POSTGRES_DB: chordarium
    ports:
      - "5432:5432"
    volumes:
      - chordarium-postgres:/var/lib/postgresql/data

volumes:
  chordarium-postgres:
```

Add to `requirements.txt` (after `pytest==8.*`):

```
psycopg[binary]>=3.2,<4
```

In `server/tests/conftest.py`, add (keep the existing `TIMELINE`/`timeline`
fixture as-is, just add these below the imports and above them):

```python
import os

import psycopg

from server.store import Store

TEST_DSN = os.environ.get("DATABASE_URL", "postgresql://chordarium:chordarium@localhost:5432/chordarium")


@pytest.fixture
def store():
    with psycopg.connect(TEST_DSN, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS songs, jobs")
    return Store(TEST_DSN)
```

(`Store.__init__` — unchanged in this task, still SQLite for now — will be
made to accept this DSN in Task 2. This step only wires the fixture; it's
expected to still fail until Task 2 lands. That's fine — Task 1's own test
doesn't pass until Task 2 either; see the note in Step 4.)

- [ ] **Step 4: Run `docker compose up -d`, then verify the round-trip test's failure mode changes**

Run: `docker compose up -d` (starts the local Postgres; run once, it keeps
running across future test runs).
Run: `python -m pytest server/tests/test_store_fixture.py -v`
Expected: FAIL, but now with a *different* error — `Store.__init__()` still
expects a SQLite file path, not a Postgres DSN, so this fails with a
SQLite-specific error (e.g. trying to open the DSN string as a file path) or
a `psycopg` connection succeeding but `Store` never using it. This confirms
the fixture is wired to the right place and the remaining gap is entirely in
`Store` itself — Task 2's job. Do not attempt to make this test pass in this
task.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml requirements.txt server/tests/conftest.py server/tests/test_store_fixture.py
git commit -m "$(cat <<'EOF'
feat: add local Postgres via docker-compose and a shared test fixture

The Postgres migration in the next commit needs somewhere real to run
against, for both the dev server and the test suite. This adds the
compose file, the psycopg dependency, and a fresh-tables-per-test
fixture that later store/app/worker tests will share.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migrate `Store` to Postgres and add job-queue methods

**Files:**
- Modify: `server/store.py` (full rewrite: `sqlite3` → `psycopg`, plus
  `cancel_requested` column, `claim_next_job`, `request_cancel`)
- Modify: `server/tests/test_store.py` (remove the local SQLite `store`
  fixture — use the shared one from `conftest.py`; add tests for the two
  new methods, including a real-concurrency test for `claim_next_job`)
- Delete: `server/tests/test_store_fixture.py` (superseded by this task's
  real coverage)

**Interfaces:**
- Consumes: the `store` fixture from Task 1's `conftest.py`.
- Produces: `Store(dsn: str)` (constructor signature changed from a
  SQLite file path to a Postgres DSN string); `Store.claim_next_job() ->
  dict | None` (claims and returns the oldest `queued` job, atomically,
  race-free against other callers); `Store.request_cancel(job_id: str) ->
  bool` (`True` if the job existed; a `queued` job is cancelled
  immediately, a running one gets `cancel_requested` set for the worker to
  notice, a job already in a final state is left untouched). Tasks 3 and 4
  call these two new methods by these exact names/signatures.

- [ ] **Step 1: Write the failing tests**

Replace `server/tests/test_store.py` in full:

```python
import threading

import pytest


def test_job_lifecycle(store):
    job_id = store.create_job("abcdefghijk", "fast")
    assert store.get_job(job_id)["state"] == "queued"
    store.update_job(job_id, state="chords", progress=60, message="Recognizing chords")
    job = store.get_job(job_id)
    assert (job["state"], job["progress"], job["message"]) == ("chords", 60, "Recognizing chords")
    assert store.get_job("missing") is None


def test_update_job_rejects_unknown_fields(store):
    job_id = store.create_job("abcdefghijk", "fast")
    with pytest.raises(ValueError):
        store.update_job(job_id, video_id="other")


def test_fail_interrupted_jobs(store):
    running = store.create_job("abcdefghijk", "fast")
    store.update_job(running, state="beats")
    done = store.create_job("abcdefghijk", "fast")
    store.update_job(done, state="done")
    assert store.fail_interrupted_jobs() == 1
    assert store.get_job(running)["state"] == "failed"
    assert store.get_job(done)["state"] == "done"


def test_get_active_job(store):
    assert store.get_active_job("abcdefghijk") is None
    job_id = store.create_job("abcdefghijk", "fast")
    assert store.get_active_job("abcdefghijk")["id"] == job_id
    store.update_job(job_id, state="failed")
    assert store.get_active_job("abcdefghijk") is None


def test_save_is_upsert_by_video(store, timeline):
    first = store.save_song(timeline)
    timeline["title"] = "Renamed"
    assert store.save_song(timeline) == first
    song = store.get_song(first)
    assert song["title"] == "Renamed" and song["timeline"]["key"] == "G:min"
    assert store.get_song_by_video("abcdefghijk")["id"] == first
    assert [s["id"] for s in store.list_songs()] == [first]
    assert "timeline" not in store.list_songs()[0]


def test_delete(store, timeline):
    song_id = store.save_song(timeline)
    assert store.delete_song(song_id) is True
    assert store.get_song(song_id) is None
    assert store.delete_song(song_id) is False


def test_claim_next_job_picks_oldest_queued(store):
    first = store.create_job("abcdefghijk", "fast")
    store.create_job("abcdefghijk", "fast")
    claimed = store.claim_next_job()
    assert claimed["id"] == first
    assert claimed["state"] == "downloading"
    assert store.get_job(first)["state"] == "downloading"


def test_claim_next_job_skips_non_queued(store):
    job_id = store.create_job("abcdefghijk", "fast")
    store.update_job(job_id, state="done")
    assert store.claim_next_job() is None


def test_claim_next_job_is_race_free_across_connections(store):
    from server.tests.conftest import TEST_DSN
    from server.store import Store

    store.create_job("abcdefghijk", "fast")
    other = Store(TEST_DSN)
    results = []

    def claim(s):
        results.append(s.claim_next_job())

    t1 = threading.Thread(target=claim, args=(store,))
    t2 = threading.Thread(target=claim, args=(other,))
    t1.start(); t2.start()
    t1.join(); t2.join()

    claimed = [r for r in results if r is not None]
    assert len(claimed) == 1


def test_request_cancel_on_queued_job_cancels_immediately(store):
    job_id = store.create_job("abcdefghijk", "fast")
    assert store.request_cancel(job_id) is True
    assert store.get_job(job_id)["state"] == "cancelled"


def test_request_cancel_on_running_job_sets_flag(store):
    job_id = store.create_job("abcdefghijk", "fast")
    store.claim_next_job()
    assert store.request_cancel(job_id) is True
    assert store.get_job(job_id)["cancel_requested"] is True
    assert store.get_job(job_id)["state"] != "cancelled"


def test_request_cancel_on_finished_job_is_a_noop(store):
    job_id = store.create_job("abcdefghijk", "fast")
    store.update_job(job_id, state="done")
    assert store.request_cancel(job_id) is True
    assert store.get_job(job_id)["state"] == "done"


def test_request_cancel_on_missing_job(store):
    assert store.request_cancel("nope") is False
```

Delete `server/tests/test_store_fixture.py` (`git rm` it, or just delete the
file — it did its job in Task 1).

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose up -d` (if not already running from Task 1).
Run: `python -m pytest server/tests/test_store.py -v`
Expected: FAIL — `Store.__init__` still takes a SQLite path; every test
using the Postgres `store` fixture errors out before assertions run.

- [ ] **Step 3: Rewrite `store.py`**

Replace `server/store.py` in full:

```python
"""Postgres persistence for analysis jobs and song chord timelines."""
import json
import threading
import uuid
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        duration REAL NOT NULL,
        key TEXT NOT NULL,
        tempo REAL NOT NULL,
        timeline_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        error TEXT,
        song_id TEXT,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL
    )
    """,
)
JOB_FIELDS = {"state", "progress", "message", "error", "song_id"}
FINAL_STATES = ("done", "failed", "cancelled")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, dsn: str):
        self._conn = psycopg.connect(dsn, autocommit=True, row_factory=dict_row)
        for stmt in SCHEMA:
            self._conn.execute(stmt)
        self._lock = threading.Lock()

    def _exec(self, sql: str, params: tuple = ()):
        with self._lock:
            return self._conn.execute(sql, params)

    # ---- jobs ----
    def create_job(self, video_id: str, mode: str) -> str:
        job_id = uuid.uuid4().hex
        self._exec("INSERT INTO jobs (id, video_id, mode, state, progress, message, created_at) "
                   "VALUES (%s, %s, %s, 'queued', 0, 'Waiting to start', %s)", (job_id, video_id, mode, _now()))
        return job_id

    def update_job(self, job_id: str, **fields) -> None:
        unknown = set(fields) - JOB_FIELDS
        if unknown:
            raise ValueError(f"Unknown job fields: {sorted(unknown)}")
        if not fields:
            return
        cols = ", ".join(f"{k} = %s" for k in fields)
        self._exec(f"UPDATE jobs SET {cols} WHERE id = %s", (*fields.values(), job_id))

    def get_job(self, job_id: str) -> dict | None:
        return self._exec("SELECT * FROM jobs WHERE id = %s", (job_id,)).fetchone()

    def get_active_job(self, video_id: str) -> dict | None:
        return self._exec(f"SELECT * FROM jobs WHERE video_id = %s AND state NOT IN {FINAL_STATES} "
                          "ORDER BY created_at DESC LIMIT 1", (video_id,)).fetchone()

    def fail_interrupted_jobs(self) -> int:
        cur = self._exec("UPDATE jobs SET state = 'failed', error = 'The server restarted during analysis.' "
                         f"WHERE state NOT IN {FINAL_STATES}")
        return cur.rowcount

    def claim_next_job(self) -> dict | None:
        return self._exec(
            "UPDATE jobs SET state = 'downloading', message = 'Downloading audio' "
            "WHERE id = (SELECT id FROM jobs WHERE state = 'queued' "
            "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING *"
        ).fetchone()

    def request_cancel(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        if job is None:
            return False
        if job["state"] == "queued":
            self.update_job(job_id, state="cancelled", message="Cancelled")
        elif job["state"] not in FINAL_STATES:
            self._exec("UPDATE jobs SET cancel_requested = TRUE WHERE id = %s", (job_id,))
        return True

    # ---- songs ----
    def save_song(self, timeline: dict) -> str:
        blob = json.dumps(timeline)
        meta = (timeline["title"], timeline["duration"], timeline["key"], timeline["tempo"])
        existing = self.get_song_by_video(timeline["video_id"])
        if existing:
            self._exec("UPDATE songs SET title=%s, duration=%s, key=%s, tempo=%s, timeline_json=%s, "
                       "updated_at=%s WHERE id=%s", (*meta, blob, _now(), existing["id"]))
            return existing["id"]
        song_id = uuid.uuid4().hex
        now = _now()
        self._exec("INSERT INTO songs (id, video_id, title, duration, key, tempo, timeline_json, "
                   "created_at, updated_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                   (song_id, timeline["video_id"], *meta, blob, now, now))
        return song_id

    @staticmethod
    def _song(row: dict | None, with_timeline: bool = True) -> dict | None:
        if row is None:
            return None
        song = {k: row[k] for k in ("id", "video_id", "title", "duration", "key", "tempo",
                                    "created_at", "updated_at")}
        if with_timeline:
            song["timeline"] = json.loads(row["timeline_json"])
        return song

    def get_song(self, song_id: str) -> dict | None:
        return self._song(self._exec("SELECT * FROM songs WHERE id = %s", (song_id,)).fetchone())

    def get_song_by_video(self, video_id: str) -> dict | None:
        return self._song(self._exec("SELECT * FROM songs WHERE video_id = %s", (video_id,)).fetchone())

    def list_songs(self) -> list[dict]:
        rows = self._exec("SELECT * FROM songs ORDER BY updated_at DESC").fetchall()
        return [self._song(r, with_timeline=False) for r in rows]

    def delete_song(self, song_id: str) -> bool:
        return self._exec("DELETE FROM songs WHERE id = %s", (song_id,)).rowcount > 0
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_store.py -v`
Expected: PASS, all cases including the two-thread `claim_next_job` race test.

- [ ] **Step 5: Commit**

```bash
git add server/store.py server/tests/test_store.py
git rm server/tests/test_store_fixture.py
git commit -m "$(cat <<'EOF'
feat: migrate Store from SQLite to Postgres, add job-queue methods

Render's web and worker services won't share a filesystem, so SQLite
can't be the shared source of truth once they're split into separate
services. claim_next_job uses FOR UPDATE SKIP LOCKED so multiple worker
instances can never double-claim the same job; request_cancel replaces
the in-memory threading.Event a same-process JobRunner used to signal
cancellation, since that doesn't reach across processes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add the standalone worker process

**Files:**
- Create: `server/worker.py`
- Create: `server/tests/test_worker.py`

**Interfaces:**
- Consumes: `Store.claim_next_job`, `Store.get_job`, `Store.update_job`,
  `Store.save_song`, `Store.fail_interrupted_jobs` (Task 2);
  `pipeline.analyze`, `pipeline.Options`, `pipeline.Cancelled`, and
  `ingest.IngestError` (existing, unchanged).
- Produces: `run_once(store: Store, work_root: Path, analyze_fn=pipeline.analyze,
  keep_audio: bool = False) -> bool` (claims and fully processes at most one
  job; returns `False` with no side effects if the queue was empty) and
  `main()` (the real entry point: loads `DATABASE_URL`, calls
  `store.fail_interrupted_jobs()` once at startup, then loops `run_once`
  forever with a poll delay when idle). Task 4 does **not** call either of
  these — the web service and the worker never call into each other
  directly, only through the shared database.

- [ ] **Step 1: Write the failing tests**

Create `server/tests/test_worker.py`:

```python
from server.engine.ingest import IngestError
from server.worker import run_once


def test_run_once_returns_false_when_queue_is_empty(store, tmp_path):
    assert run_once(store, tmp_path) is False


def test_successful_job_saves_song_and_cleans_audio(store, tmp_path, timeline):
    def analyze(video_id, work_dir, options, progress):
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / "audio.wav").write_bytes(b"x")
        assert options.mode == "accurate"
        progress("chords", 60, "Recognizing chords")
        return timeline

    job_id = store.create_job("abcdefghijk", "accurate")
    assert run_once(store, tmp_path, analyze_fn=analyze) is True
    job = store.get_job(job_id)
    assert job["state"] == "done" and job["progress"] == 100
    assert store.get_song(job["song_id"])["title"] == "Test Song"
    assert not (tmp_path / "abcdefghijk").exists()


def test_ingest_error_message_reaches_job(store, tmp_path):
    def analyze(*a):
        raise IngestError("This video is private.")

    job_id = store.create_job("abcdefghijk", "fast")
    run_once(store, tmp_path, analyze_fn=analyze)
    job = store.get_job(job_id)
    assert (job["state"], job["error"]) == ("failed", "This video is private.")


def test_unexpected_error_is_wrapped(store, tmp_path):
    def analyze(*a):
        raise RuntimeError("kaboom")

    job_id = store.create_job("abcdefghijk", "fast")
    run_once(store, tmp_path, analyze_fn=analyze)
    assert store.get_job(job_id)["error"] == "Analysis failed: kaboom"


def test_cancel_requested_mid_job_stops_it_as_cancelled(store, tmp_path, timeline):
    def analyze(video_id, work_dir, options, progress):
        progress("beats", 45, "Detecting beats")
        store.request_cancel(job_id)
        progress("chords", 60, "Recognizing chords")
        return timeline

    job_id = store.create_job("abcdefghijk", "fast")
    run_once(store, tmp_path, analyze_fn=analyze)
    assert store.get_job(job_id)["state"] == "cancelled"
    assert store.list_songs() == []


def test_keep_audio_leaves_the_work_dir(store, tmp_path, timeline):
    def analyze(video_id, work_dir, options, progress):
        work_dir.mkdir(parents=True, exist_ok=True)
        return timeline

    store.create_job("abcdefghijk", "fast")
    run_once(store, tmp_path, analyze_fn=analyze, keep_audio=True)
    assert (tmp_path / "abcdefghijk").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest server/tests/test_worker.py -v`
Expected: FAIL with "No module named 'server.worker'".

- [ ] **Step 3: Write `server/worker.py`**

```python
"""Standalone worker: polls the jobs table and runs the analysis pipeline.

Runs as its own process/service, separate from the Flask API, so a slow
analysis never blocks request handling. Talks to the API only through the
shared database — never imports server.app.
"""
import logging
import os
import shutil
import time
from pathlib import Path

from server.engine import pipeline
from server.engine.ingest import IngestError
from server.store import Store

log = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 2.0


def run_once(store: Store, work_root: Path, analyze_fn=pipeline.analyze, keep_audio: bool = False) -> bool:
    """Claim and fully process one queued job, if any. Returns whether one was found."""
    job = store.claim_next_job()
    if job is None:
        return False
    job_id, video_id, mode = job["id"], job["video_id"], job["mode"]
    work_dir = Path(work_root) / video_id

    def progress(state: str, percent: int, message: str) -> None:
        if store.get_job(job_id)["cancel_requested"]:
            raise pipeline.Cancelled()
        store.update_job(job_id, state=state, progress=percent, message=message)

    try:
        timeline = analyze_fn(video_id, work_dir, pipeline.Options(mode=mode), progress)
        song_id = store.save_song(timeline)
        store.update_job(job_id, state="done", progress=100, message="Done", song_id=song_id)
    except pipeline.Cancelled:
        store.update_job(job_id, state="cancelled", message="Cancelled")
    except IngestError as e:
        store.update_job(job_id, state="failed", error=str(e), message="Failed")
    except Exception as e:
        log.exception("Job %s failed", job_id)
        store.update_job(job_id, state="failed", error=f"Analysis failed: {e}", message="Failed")
    finally:
        if not keep_audio:
            shutil.rmtree(work_dir, ignore_errors=True)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    store = Store(os.environ["DATABASE_URL"])
    work_root = Path(os.environ.get("CHORDARIUM_DATA", Path(__file__).parent / "data")) / "audio"
    reset = store.fail_interrupted_jobs()
    if reset:
        log.info("Marked %d job(s) failed after worker restart", reset)
    log.info("Worker started, polling every %ss", POLL_INTERVAL_SECONDS)
    while True:
        if not run_once(store, work_root):
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_worker.py -v`
Expected: PASS, all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add server/worker.py server/tests/test_worker.py
git commit -m "$(cat <<'EOF'
feat: add the standalone polling worker process

Replaces JobRunner's in-process ThreadPoolExecutor. run_once claims one
job via Store.claim_next_job (race-free across multiple worker
instances) and runs the same pipeline.analyze the old runner used;
cancellation is checked through Store.request_cancel's flag on the
shared database instead of an in-memory threading.Event, since that
never reached across a process boundary.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update the web service to drop `JobRunner`

**Files:**
- Modify: `server/app.py`
- Modify: `server/tests/test_app.py`

**Interfaces:**
- Consumes: `Store.create_job`, `Store.request_cancel` (Task 2).
- Produces: `create_app(config: dict | None = None, store: Store | None =
  None) -> Flask` — the `runner` parameter is removed entirely. No other
  route contracts change.

- [ ] **Step 1: Write the failing tests**

Replace `server/tests/test_app.py` in full (only the `ctx` fixture and the
three tests that referenced `runner`/`FakeRunner` change; everything else —
export tests, edit/reset-routes-gone test — is unchanged from its current
content and is included here verbatim so the file stays complete):

```python
import copy
import subprocess
import sys

import pytest

from server.app import create_app

VID = "dQw4w9WgXcQ"


@pytest.fixture
def ctx(store, tmp_path):
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True}, store=store)
    return app.test_client(), store


def test_analyze_validates_input(ctx):
    client, store = ctx
    assert client.post("/api/analyze", json={"url": "https://vimeo.com/1"}).status_code == 400
    assert client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}", "mode": "turbo"}).status_code == 400
    assert client.post("/api/analyze", json={}).status_code == 400
    assert store.list_songs() == []


def test_analyze_starts_job_then_polls(ctx):
    client, store = ctx
    r = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}?si=x", "mode": "accurate"})
    assert r.status_code == 202
    job_id = r.get_json()["job_id"]
    job = store.get_job(job_id)
    assert (job["video_id"], job["mode"], job["state"]) == (VID, "accurate", "queued")
    assert client.get(f"/api/jobs/{job_id}").get_json()["state"] == "queued"
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/cancel").get_json() == {"cancelled": True}
    assert store.get_job(job_id)["state"] == "cancelled"
    assert client.post("/api/jobs/nope/cancel").status_code == 404


def test_analyze_twice_reuses_running_job(ctx):
    client, store = ctx
    first = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}"}).get_json()["job_id"]
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 202 and r.get_json() == {"job_id": first}
    assert store.get_active_job(VID)["id"] == first


def test_analyze_returns_cached_song(ctx, timeline):
    client, store = ctx
    timeline["video_id"] = VID
    song_id = store.save_song(timeline)
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 200 and r.get_json() == {"song_id": song_id, "cached": True}
    assert store.get_active_job(VID) is None


def test_song_crud(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.get("/api/songs").get_json()[0]["id"] == song_id
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["key"] == "G:min"
    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_edit_and_reset_routes_are_gone(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.put(f"/api/songs/{song_id}/segments/0", json={"label": "C:min"}).status_code == 404
    assert client.post(f"/api/songs/{song_id}/reset").status_code == 404
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["segments"][0]["label"] == "C:min7"


@pytest.mark.parametrize("fmt,mimetype,ext", [
    ("chordpro", "text/plain", "cho"), ("txt", "text/plain", "txt"), ("json", "application/json", "json"),
    ("pdf", "application/pdf", "pdf"), ("midi", "audio/midi", "mid"),
])
def test_exports(ctx, timeline, fmt, mimetype, ext):
    client, store = ctx
    song_id = store.save_song(timeline)
    r = client.post(f"/api/songs/{song_id}/export?fmt={fmt}&transpose=1&capo=2&simplify=1&bars_per_row=8",
                    json={"timeline": timeline})
    assert r.status_code == 200
    assert r.mimetype == mimetype
    assert r.headers["Content-Disposition"] == f'attachment; filename="Test-Song.{ext}"'


def test_export_uses_the_posted_timeline_not_the_stored_one(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    edited = copy.deepcopy(timeline)
    edited["segments"][0]["label"] = "G:maj"
    r = client.post(f"/api/songs/{song_id}/export?fmt=json", json={"timeline": edited})
    assert r.get_json()["segments"][0]["label"] == "G:maj"
    assert store.get_song(song_id)["timeline"]["segments"][0]["label"] == "C:min7"


def test_export_requires_a_timeline_body(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json={}).status_code == 400
    assert client.post(f"/api/songs/{song_id}/export?fmt=json").status_code == 400


@pytest.mark.parametrize("bad_timeline", [
    {"segments": []},
    {"segments": "x"},
    "not-a-dict",
])
def test_export_rejects_incomplete_timeline_with_400(ctx, timeline, bad_timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad_timeline}).status_code == 400


def test_export_rejects_a_bad_chord_label_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    bad = copy.deepcopy(timeline)
    bad["segments"][0]["label"] = "H:maj"
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad}).status_code == 400


def test_export_rejects_a_segment_missing_start_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    bad = copy.deepcopy(timeline)
    del bad["segments"][0]["start"]
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad}).status_code == 400


def test_export_rejects_a_non_object_body_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json=[1, 2]).status_code == 400


@pytest.mark.parametrize("query", ["fmt=docx", "fmt=pdf&transpose=9", "fmt=pdf&capo=-1",
                                   "fmt=pdf&bars_per_row=5", "fmt=pdf&transpose=abc"])
def test_export_rejects_bad_params(ctx, timeline, query):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?{query}", json={"timeline": timeline}).status_code == 400


def test_app_module_does_not_import_the_pipeline():
    """A fresh process importing only server.app must never pull in the
    pipeline (librosa/torch/Demucs) - that heavy-CPU import chain is exactly
    what this split keeps off the request-handling process. Run in a
    subprocess: sys.modules is shared across this whole pytest session, and
    test_worker.py/test_pipeline.py legitimately import the pipeline
    elsewhere in it, so checking sys.modules in-process would pass or fail
    based on test order, not on server.app's own import graph.
    """
    result = subprocess.run(
        [sys.executable, "-c", "import server.app, sys; assert 'server.engine.pipeline' not in sys.modules"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def test_create_app_never_marks_jobs_failed_on_startup(store, tmp_path):
    """Restarting the web service must not touch jobs a separate worker still owns.

    The old JobRunner-based app called store.fail_interrupted_jobs() when it
    started, because restarting that process really did orphan any job it
    was running in-thread. That's no longer true once the worker is a
    separate process - creating (or re-creating) the Flask app must leave
    an in-progress job alone.
    """
    job_id = store.create_job("abcdefghijk", "fast")
    store.update_job(job_id, state="beats")
    create_app({"DATA_DIR": tmp_path, "TESTING": True}, store=store)
    assert store.get_job(job_id)["state"] == "beats"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest server/tests/test_app.py -v`
Expected: FAIL — `create_app(..., store=store)` with no `runner=` still
constructs a `JobRunner` internally today, and the `ctx` fixture no longer
provides one to inject, so most tests error on the missing `runner`
reference removed from this file; `test_app_module_does_not_import_the_pipeline`
fails because `server.engine.pipeline` *is* still imported transitively via
`server.jobs`; and `test_create_app_never_marks_jobs_failed_on_startup`
fails because today's `create_app` still calls
`store.fail_interrupted_jobs()` unconditionally, flipping the `beats` job
to `failed`.

- [ ] **Step 3: Update `app.py`**

In `server/app.py`, remove the `JobRunner` import and change `create_app`
and the two routes that used `runner`:

```python
"""Chordarium HTTP API."""
import logging
import os
import re

from flask import Flask, Response, jsonify, request

from server.engine.ingest import parse_video_id
from server.export.chordpro import to_chordpro
from server.export.grid import ExportOptions
from server.export.json_export import to_json
from server.export.midi import to_midi
from server.export.pdf import to_pdf
from server.export.txt import to_txt
from server.store import Store

EXPORTERS = {
    "chordpro": (to_chordpro, "text/plain", "cho"),
    "txt": (to_txt, "text/plain", "txt"),
    "json": (to_json, "application/json", "json"),
    "pdf": (to_pdf, "application/pdf", "pdf"),
    "midi": (to_midi, "audio/midi", "mid"),
}
MODES = ("fast", "accurate")


class BadRequest(Exception):
    pass


def _int_arg(name: str, default: int, lo: int, hi: int, allowed: tuple[int, ...] | None = None) -> int:
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise BadRequest(f"{name} must be a whole number")
    if not lo <= value <= hi or (allowed and value not in allowed):
        raise BadRequest(f"{name} is out of range")
    return value


def _slug(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-") or "chordarium"


def create_app(config: dict | None = None, store: Store | None = None) -> Flask:
    app = Flask(__name__)
    if config:
        app.config.update(config)
    store = store or Store(os.environ["DATABASE_URL"])

    def error(message: str, status: int):
        return jsonify({"error": message}), status

    @app.errorhandler(BadRequest)
    def _bad_request(e):
        return error(str(e), 400)

    @app.post("/api/analyze")
    def analyze():
        body = request.get_json(silent=True) or {}
        mode = body.get("mode", "fast")
        if mode not in MODES:
            raise BadRequest("mode must be 'fast' or 'accurate'")
        video_id = parse_video_id(str(body.get("url", "")))
        if not video_id:
            raise BadRequest("That doesn't look like a YouTube video link.")
        cached = store.get_song_by_video(video_id)
        if cached:
            return jsonify({"song_id": cached["id"], "cached": True})
        active = store.get_active_job(video_id)
        if active:
            return jsonify({"job_id": active["id"]}), 202
        return jsonify({"job_id": store.create_job(video_id, mode)}), 202

    @app.get("/api/jobs/<job_id>")
    def get_job(job_id):
        job = store.get_job(job_id)
        return jsonify(job) if job else error("Job not found", 404)

    @app.post("/api/jobs/<job_id>/cancel")
    def cancel_job(job_id):
        return jsonify({"cancelled": store.request_cancel(job_id)}) if store.get_job(job_id) else error("Job not found", 404)

    @app.get("/api/songs")
    def list_songs():
        return jsonify(store.list_songs())

    @app.get("/api/songs/<song_id>")
    def get_song(song_id):
        song = store.get_song(song_id)
        return jsonify(song) if song else error("Song not found", 404)

    @app.delete("/api/songs/<song_id>")
    def delete_song(song_id):
        return ("", 204) if store.delete_song(song_id) else error("Song not found", 404)

    @app.post("/api/songs/<song_id>/export")
    def export_song(song_id):
        song = store.get_song(song_id)
        if song is None:
            return error("Song not found", 404)
        body = request.get_json(silent=True)
        body = body if isinstance(body, dict) else {}
        timeline = body.get("timeline")
        if not isinstance(timeline, dict) or not isinstance(timeline.get("segments"), list):
            raise BadRequest("Request body must include a 'timeline' object with a segments list.")
        fmt = request.args.get("fmt", "pdf")
        if fmt not in EXPORTERS:
            raise BadRequest(f"fmt must be one of {', '.join(EXPORTERS)}")
        opts = ExportOptions(
            transpose=_int_arg("transpose", 0, -6, 6),
            capo=_int_arg("capo", 0, 0, 7),
            simplify=request.args.get("simplify") in ("1", "true"),
            bars_per_row=_int_arg("bars_per_row", 4, 4, 8, allowed=(4, 8)),
        )
        render, mimetype, ext = EXPORTERS[fmt]
        try:
            data = render(timeline, opts)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as e:
            raise BadRequest(f"Invalid timeline: {e}")
        if isinstance(data, str):
            data = data.encode("utf-8")
        filename = f"{_slug(song['title'])}.{ext}"
        return Response(data, mimetype=mimetype,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    create_app().run(host="127.0.0.1", port=5000, debug=False)
```

Note what's deliberately gone from the old version: the `Path` import, the
`DATA_DIR`/`KEEP_AUDIO` config defaults and `data_dir.mkdir(...)` call, and
`store.fail_interrupted_jobs()` — none of that belongs to the web service
any more (Task 3's `worker.main()` owns the work directory and the
restart-recovery call now). The `ctx` fixture in the test file still passes
`{"DATA_DIR": tmp_path, "TESTING": True}` as `config` for now, which is
harmless (`app.config.update` just stores unused keys) — leave it there
rather than touching the test fixture's shape further, since a later
Render-deploy pass may still want per-request temp paths for something
else; this task's job is removing the runner, not chasing every now-unused
config key.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest server/tests/test_app.py -v`
Expected: PASS, all cases including the new
`test_app_module_does_not_import_the_pipeline` and
`test_create_app_never_marks_jobs_failed_on_startup`.

- [ ] **Step 5: Commit**

```bash
git add server/app.py server/tests/test_app.py
git commit -m "$(cat <<'EOF'
fix: drop JobRunner from the web service

/api/analyze and /api/jobs/<id>/cancel now go straight through the
store (create_job, request_cancel) instead of an in-process runner that
executed the pipeline itself. The web service no longer imports the
pipeline, runs Demucs/BTC, or touches a work directory at all - that's
the worker's job now, reached only through the shared database.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Remove `server/jobs.py`

**Files:**
- Delete: `server/jobs.py`
- Delete: `server/tests/test_jobs.py`

**Interfaces:**
- Consumes: nothing (this task only deletes dead code — Task 3's
  `worker.py` and Task 4's `app.py` already replaced everything `jobs.py`
  did, and nothing still imports it).
- Produces: nothing new.

- [ ] **Step 1: Confirm nothing still imports `server.jobs`**

Run: `grep -rn "server.jobs\|from server import jobs\|JobRunner" server client --include=*.py`
Expected: no output (Task 4 already removed the only import, in
`server/app.py`).

- [ ] **Step 2: Delete the files**

```bash
git rm server/jobs.py server/tests/test_jobs.py
```

- [ ] **Step 3: Run the full server suite to confirm nothing broke**

Run: `python -m pytest`
Expected: PASS — same pass count as after Task 4, minus `test_jobs.py`'s
now-deleted cases (those behaviors are already covered by
`test_worker.py` from Task 3).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore: remove jobs.py, superseded by the worker.py process split

JobRunner's in-process ThreadPoolExecutor has no callers left - Task 3's
worker.py and Task 4's app.py replaced everything it did.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full-suite verification and a real two-process smoke check

**Files:** none (verification only).

- [ ] **Step 1: Run the full server test suite**

Run: `docker compose up -d && python -m pytest`
Expected: PASS (fast tests; `-m "not slow"` remains the default per
`pytest.ini`).

- [ ] **Step 2: Run the full client test suite (unaffected by this plan, confirms nothing else regressed)**

Run: `npm --prefix client test`
Expected: PASS.

- [ ] **Step 3: Manual two-process smoke check against the real local Postgres**

This is the one check no automated test can give you: that the web service
and a separately-started worker process actually agree on the same real
Postgres and hand a job off correctly end to end, not just against fixtures.

In one terminal:
```powershell
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5432/chordarium"
python -m server.app
```
In a second terminal:
```powershell
$env:DATABASE_URL = "postgresql://chordarium:chordarium@localhost:5432/chordarium"
python -m server.worker
```
In a third terminal, submit a short real video and poll it:
```powershell
curl -X POST http://127.0.0.1:5000/api/analyze -H "Content-Type: application/json" -d '{"url":"https://www.youtube.com/watch?v=<a short public video you have rights to analyze>","mode":"fast"}'
# note the job_id from the response, then:
curl http://127.0.0.1:5000/api/jobs/<job_id>
```
Expected: the job progresses through the same states as before
(`queued → downloading → beats → chords → bass → key → done`) and
`GET /api/songs` afterward lists it — confirming the worker (a separate
OS process, started independently) picked up a job the web service only
wrote to Postgres, never called directly. Stop both processes
(Ctrl+C) when done.

- [ ] **Step 4: Update the README's status line**

In `README.md`, change:

```markdown
**Status:** Phase 1 complete — local Flask API + React client. See
[`docs/superpowers/specs/2026-09-26-chordarium-design.md`](docs/superpowers/specs/2026-09-26-chordarium-design.md).
```

to:

```markdown
**Status:** Phase 1 complete. Backend now runs on Postgres with a
separate worker process (no hosting yet — that's next). See
[`docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md`](docs/superpowers/specs/2026-09-27-chordarium-hosted-platform-design.md).
```

And add a line after the existing `Requires ffmpeg on PATH.`:

```markdown
Requires a local Postgres: `docker compose up -d` (or point `DATABASE_URL`
at your own). Run the worker in a second terminal: `python -m server.worker`.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: update README for the Postgres + worker split

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
