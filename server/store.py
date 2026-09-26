"""SQLite persistence for analysis jobs and song chord timelines."""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
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
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    state TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    song_id TEXT,
    created_at TEXT NOT NULL
);
"""
JOB_FIELDS = {"state", "progress", "message", "error", "song_id"}
FINAL_STATES = ("done", "failed", "cancelled")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, path):
        self._conn = sqlite3.connect(str(Path(path)), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._lock = threading.Lock()

    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    # ---- jobs ----
    def create_job(self, video_id: str, mode: str) -> str:
        job_id = uuid.uuid4().hex
        self._exec("INSERT INTO jobs (id, video_id, mode, state, progress, message, created_at) "
                   "VALUES (?, ?, ?, 'queued', 0, 'Waiting to start', ?)", (job_id, video_id, mode, _now()))
        return job_id

    def update_job(self, job_id: str, **fields) -> None:
        unknown = set(fields) - JOB_FIELDS
        if unknown:
            raise ValueError(f"Unknown job fields: {sorted(unknown)}")
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        self._exec(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))

    def get_job(self, job_id: str) -> dict | None:
        row = self._exec("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def get_active_job(self, video_id: str) -> dict | None:
        row = self._exec(f"SELECT * FROM jobs WHERE video_id = ? AND state NOT IN {FINAL_STATES} "
                         "ORDER BY created_at DESC LIMIT 1", (video_id,)).fetchone()
        return dict(row) if row else None

    def fail_interrupted_jobs(self) -> int:
        cur = self._exec("UPDATE jobs SET state = 'failed', error = 'The server restarted during analysis.' "
                         f"WHERE state NOT IN {FINAL_STATES}")
        return cur.rowcount

    # ---- songs ----
    def save_song(self, timeline: dict) -> str:
        blob = json.dumps(timeline)
        meta = (timeline["title"], timeline["duration"], timeline["key"], timeline["tempo"])
        existing = self.get_song_by_video(timeline["video_id"])
        if existing:
            self._exec("UPDATE songs SET title=?, duration=?, key=?, tempo=?, timeline_json=?, "
                       "updated_at=? WHERE id=?", (*meta, blob, _now(), existing["id"]))
            return existing["id"]
        song_id = uuid.uuid4().hex
        now = _now()
        self._exec("INSERT INTO songs (id, video_id, title, duration, key, tempo, timeline_json, "
                   "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   (song_id, timeline["video_id"], *meta, blob, now, now))
        return song_id

    @staticmethod
    def _song(row: sqlite3.Row | None, with_timeline: bool = True) -> dict | None:
        if row is None:
            return None
        song = {k: row[k] for k in ("id", "video_id", "title", "duration", "key", "tempo",
                                    "created_at", "updated_at")}
        if with_timeline:
            song["timeline"] = json.loads(row["timeline_json"])
        return song

    def get_song(self, song_id: str) -> dict | None:
        return self._song(self._exec("SELECT * FROM songs WHERE id = ?", (song_id,)).fetchone())

    def get_song_by_video(self, video_id: str) -> dict | None:
        return self._song(self._exec("SELECT * FROM songs WHERE video_id = ?", (video_id,)).fetchone())

    def list_songs(self) -> list[dict]:
        rows = self._exec("SELECT * FROM songs ORDER BY updated_at DESC").fetchall()
        return [self._song(r, with_timeline=False) for r in rows]

    def delete_song(self, song_id: str) -> bool:
        return self._exec("DELETE FROM songs WHERE id = ?", (song_id,)).rowcount > 0
