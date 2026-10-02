"""Postgres persistence for analysis jobs and song chord timelines."""
import os
import threading
import uuid
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        video_id TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        duration REAL NOT NULL,
        key TEXT NOT NULL,
        tempo REAL NOT NULL,
        timeline_json JSONB NOT NULL,
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
    @classmethod
    def from_env(cls) -> "Store":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise SystemExit(
                "DATABASE_URL is not set. See README.md for local setup (docker compose up -d)."
            )
        return cls(dsn)

    def __init__(self, dsn: str):
        self._dsn = dsn
        self._conn = self._connect()
        self._lock = threading.Lock()

    def close(self) -> None:
        if not self._conn.closed:
            self._conn.close()

    def _connect(self):
        conn = psycopg.connect(self._dsn, autocommit=True, row_factory=dict_row)
        for stmt in SCHEMA:
            conn.execute(stmt)
        return conn

    def _exec(self, sql: str, params: tuple = ()):
        with self._lock:
            try:
                return self._conn.execute(sql, params)
            except psycopg.OperationalError:
                self._conn = self._connect()
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

    def count_active_jobs(self) -> int:
        """Analyses that are waiting or running (used to cap the queue on a public deployment)."""
        return self._exec(f"SELECT count(*) AS n FROM jobs WHERE state NOT IN {FINAL_STATES}").fetchone()["n"]

    def fail_interrupted_jobs(self) -> int:
        cur = self._exec("UPDATE jobs SET state = 'failed', error = 'The server restarted during analysis.' "
                         f"WHERE state NOT IN {FINAL_STATES + ('queued',)}")
        return cur.rowcount

    def claim_next_job(self) -> dict | None:
        return self._exec(
            "UPDATE jobs SET state = 'downloading', message = 'Downloading audio' "
            "WHERE id = (SELECT id FROM jobs WHERE state = 'queued' "
            "ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) "
            "RETURNING *"
        ).fetchone()

    def request_cancel(self, job_id: str) -> bool:
        cancelled = self._exec(
            "UPDATE jobs SET state = 'cancelled', message = 'Cancelled' "
            "WHERE id = %s AND state = 'queued' RETURNING id", (job_id,)
        ).fetchone()
        if cancelled:
            return True
        flagged = self._exec(
            f"UPDATE jobs SET cancel_requested = TRUE WHERE id = %s AND state NOT IN {FINAL_STATES} "
            "RETURNING id", (job_id,)
        ).fetchone()
        if flagged:
            return True
        return self.get_job(job_id) is not None

    # ---- songs ----
    def save_song(self, timeline: dict) -> str:
        meta = (timeline["title"], timeline["duration"], timeline["key"], timeline["tempo"])
        song_id = uuid.uuid4().hex
        now = _now()
        row = self._exec(
            "INSERT INTO songs (id, video_id, title, duration, key, tempo, timeline_json, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (video_id) DO UPDATE SET title=EXCLUDED.title, duration=EXCLUDED.duration, "
            "key=EXCLUDED.key, tempo=EXCLUDED.tempo, timeline_json=EXCLUDED.timeline_json, "
            "updated_at=EXCLUDED.updated_at "
            "RETURNING id",
            (song_id, timeline["video_id"], *meta, Jsonb(timeline), now, now),
        ).fetchone()
        return row["id"]

    @staticmethod
    def _song(row: dict | None, with_timeline: bool = True) -> dict | None:
        if row is None:
            return None
        song = {k: row[k] for k in ("id", "video_id", "title", "duration", "key", "tempo",
                                    "created_at", "updated_at")}
        song["accurate"] = bool(((row["timeline_json"] or {}).get("engine") or {}).get("separated"))
        if with_timeline:
            song["timeline"] = row["timeline_json"]
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
