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
