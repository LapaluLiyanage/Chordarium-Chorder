import threading

import pytest

from server.tests.conftest import TEST_DSN


def test_test_dsn_uses_a_dedicated_database_not_the_dev_one():
    """Tests must never share a database with DATABASE_URL - running the
    suite against a real dev/prod connection string would DROP its tables.
    """
    assert TEST_DSN.rsplit("/", 1)[1] != "chordarium"


def test_job_lifecycle(store):
    job_id = store.create_job("abcdefghijk", "fast")
    assert store.get_job(job_id)["state"] == "queued"
    store.update_job(job_id, state="chords", progress=60, message="Recognizing chords")
    job = store.get_job(job_id)
    assert (job["state"], job["progress"], job["message"]) == ("chords", 60, "Recognizing chords")
    assert store.get_job("missing") is None


def test_count_active_jobs_ignores_finished_ones(store):
    a, b = store.create_job("aaaaaaaaaaa", "fast"), store.create_job("bbbbbbbbbbb", "fast")
    assert store.count_active_jobs() == 2
    store.update_job(a, state="done")
    store.update_job(b, state="cancelled")
    assert store.count_active_jobs() == 0


def test_update_job_rejects_unknown_fields(store):
    job_id = store.create_job("abcdefghijk", "fast")
    with pytest.raises(ValueError):
        store.update_job(job_id, video_id="other")


def test_fail_interrupted_jobs(store):
    running = store.create_job("abcdefghijk", "fast")
    store.update_job(running, state="beats")
    done = store.create_job("abcdefghijk", "fast")
    store.update_job(done, state="done")
    queued = store.create_job("abcdefghijk", "fast")
    assert store.fail_interrupted_jobs() == 1
    assert store.get_job(running)["state"] == "failed"
    assert store.get_job(done)["state"] == "done"
    assert store.get_job(queued)["state"] == "queued"


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
    assert store.list_songs()[0]["accurate"] is True  # the fixture timeline was analyzed with stems


def test_store_reconnects_after_the_connection_drops(store):
    """A Postgres restart, maintenance blip, or network hiccup must not
    permanently break every future call on this Store instance - the web
    service and worker are both long-running processes that hold one Store
    for their whole lifetime.
    """
    import psycopg

    store.create_job("abcdefghijk", "fast")
    with psycopg.connect(TEST_DSN, autocommit=True) as admin:
        admin.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = current_database() AND pid <> pg_backend_pid()"
        )
    assert len(store.list_songs()) == 0
    job_id = store.create_job("abcdefghijk", "fast")
    assert store.get_job(job_id)["state"] == "queued"


def test_delete(store, timeline):
    song_id = store.save_song(timeline)
    assert store.delete_song(song_id) is True
    assert store.get_song(song_id) is None
    assert store.delete_song(song_id) is False


def test_save_song_concurrent_same_video_never_raises_a_unique_violation(store, timeline):
    """Two workers analyzing the same not-yet-cached video at the same time
    must never crash with a UNIQUE(video_id) violation - the second one to
    finish should just update the row the first one created.
    """
    from server.tests.conftest import TEST_DSN
    from server.store import Store

    other = Store(TEST_DSN)
    results = {}
    errors = []

    def save(s, key):
        try:
            results[key] = s.save_song(timeline)
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=save, args=(store, "a"))
    t2 = threading.Thread(target=save, args=(other, "b"))
    t1.start(); t2.start()
    t1.join(); t2.join()
    other.close()

    assert errors == []
    assert results["a"] == results["b"]
    assert len(store.list_songs()) == 1


def test_store_from_env_without_database_url_gives_a_clear_error(monkeypatch):
    from server.store import Store

    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit, match="DATABASE_URL"):
        Store.from_env()


def test_close_closes_the_connection(store):
    store.close()
    assert store._conn.closed


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
    barrier = threading.Barrier(2)

    def claim(s):
        barrier.wait()
        results.append(s.claim_next_job())

    t1 = threading.Thread(target=claim, args=(store,))
    t2 = threading.Thread(target=claim, args=(other,))
    t1.start(); t2.start()
    t1.join(); t2.join()
    other.close()

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


def test_request_cancel_concurrent_with_claim_leaves_a_consistent_state(store):
    """A cancel racing a worker's claim must never lose the request: either
    the cancel wins and the job never gets claimed, or the claim wins and
    the cancel still lands as a flag the worker will see. A read-then-write
    implementation can lose the flag entirely if the claim lands between
    the read and the write.
    """
    from server.tests.conftest import TEST_DSN
    from server.store import Store

    job_id = store.create_job("abcdefghijk", "fast")
    canceller = Store(TEST_DSN)
    results = {}
    barrier = threading.Barrier(2)

    def do_claim():
        barrier.wait()
        results["claimed"] = store.claim_next_job()

    def do_cancel():
        barrier.wait()
        results["cancelled"] = canceller.request_cancel(job_id)

    t1 = threading.Thread(target=do_claim)
    t2 = threading.Thread(target=do_cancel)
    t1.start(); t2.start()
    t1.join(); t2.join()
    canceller.close()

    job = store.get_job(job_id)
    assert results["cancelled"] is True
    if job["state"] == "cancelled":
        assert results["claimed"] is None
    else:
        assert job["state"] == "downloading"
        assert job["cancel_requested"] is True
