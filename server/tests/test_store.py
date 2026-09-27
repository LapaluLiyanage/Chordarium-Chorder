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

    def do_claim():
        results["claimed"] = store.claim_next_job()

    def do_cancel():
        results["cancelled"] = canceller.request_cancel(job_id)

    t1 = threading.Thread(target=do_claim)
    t2 = threading.Thread(target=do_cancel)
    t1.start(); t2.start()
    t1.join(); t2.join()

    job = store.get_job(job_id)
    assert results["cancelled"] is True
    if job["state"] == "cancelled":
        assert results["claimed"] is None
    else:
        assert job["state"] == "downloading"
        assert job["cancel_requested"] is True
