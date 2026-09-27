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
