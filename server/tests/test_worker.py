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


def test_cancel_requested_after_analyze_returns_still_cancels_before_saving(store, tmp_path, timeline):
    """A cancel that arrives after the last progress() call (so analyze_fn
    already returned a result) must still be honored - the job must not be
    silently saved as done just because no further progress() call was left
    to notice the flag.
    """
    def analyze(video_id, work_dir, options, progress):
        progress("key", 92, "Estimating key")
        store.request_cancel(job_id)
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


def test_upload_job_converts_file_and_keeps_playback_audio(store, tmp_path, timeline, monkeypatch):
    from server.engine import ingest
    sources = []

    def convert(source, out_dir):
        sources.append(source.read_bytes())
        (out_dir / "audio.wav").write_bytes(b"wav")
        (out_dir / "playback.mp3").write_bytes(b"mp3")
        return out_dir / "audio.wav", out_dir / "playback.mp3"

    def analyze(video_id, work_dir, options, progress, fetch_audio):
        meta, wav = fetch_audio(video_id, work_dir)
        return {**timeline, "video_id": video_id, "title": meta["title"]}

    monkeypatch.setattr(ingest, "convert_file", convert)
    vid = ingest.upload_id(b"raw upload")
    store.save_upload(vid, "My Song", b"raw upload")
    job_id = store.create_job(vid, "fast")
    run_once(store, tmp_path, analyze_fn=analyze)
    job = store.get_job(job_id)
    assert job["state"] == "done", job["error"]
    assert store.get_song(job["song_id"])["title"] == "My Song"
    assert bytes(store.get_audio(vid)["data"]) == b"mp3"
    assert store.get_upload(vid) is None

    # re-analysis reads the kept playback audio and keeps the title
    job_id = store.create_job(vid, "fast")
    run_once(store, tmp_path, analyze_fn=analyze)
    assert store.get_job(job_id)["state"] == "done"
    assert sources == [b"raw upload", b"mp3"]
    assert store.get_song_by_video(vid)["title"] == "My Song"
