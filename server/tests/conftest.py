import copy
import os

import psycopg
import pytest

from server.store import Store

TEST_DSN = os.environ.get("TEST_DATABASE_URL", "postgresql://chordarium:chordarium@localhost:5433/chordarium_test")


def _ensure_test_database() -> None:
    prefix, _, dbname = TEST_DSN.rpartition("/")
    with psycopg.connect(f"{prefix}/postgres", autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (dbname,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{dbname}"')


@pytest.fixture(scope="session", autouse=True)
def _test_database():
    _ensure_test_database()


@pytest.fixture
def store():
    with psycopg.connect(TEST_DSN, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS songs, jobs")
    return Store(TEST_DSN)


TIMELINE = {
    "video_id": "abcdefghijk",
    "title": "Test Song",
    "duration": 8.0,
    "key": "G:min",
    "tempo": 120.0,
    "time_signature": 4,
    "beats": [i * 0.5 for i in range(16)],
    "downbeats": [0.0, 2.0, 4.0, 6.0],
    "segments": [
        {"start": 0.0, "end": 2.0, "label": "C:min7", "alt": "C:min", "confidence": 0.8, "bass": "C", "edited": False},
        {"start": 2.0, "end": 4.0, "label": "F:7", "alt": "F:maj", "confidence": 0.7, "bass": "F", "edited": False},
        {"start": 4.0, "end": 5.0, "label": "A#:maj7", "alt": None, "confidence": 0.6, "bass": "A#", "edited": False},
        {"start": 5.0, "end": 6.0, "label": "D#:maj7", "alt": None, "confidence": 0.6, "bass": "D#", "edited": False},
        {"start": 6.0, "end": 8.0, "label": "D:7/3", "alt": "D:7", "confidence": 0.5, "bass": "F#", "edited": False},
    ],
    "engine": {"chords": "btc-large", "separated": True, "version": "1"},
    "warnings": [],
}


@pytest.fixture
def timeline():
    return copy.deepcopy(TIMELINE)
