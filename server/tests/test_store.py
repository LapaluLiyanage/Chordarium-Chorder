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
