from server.engine import pipeline
from server.engine.pipeline import Options, analyze
from server.tests.synth import label_at, progression, write_wav


def fake_fetch(video_id, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    y = progression([([0, 4, 7], 4.0, 0), ([7, 11, 2], 4.0, 11), ([9, 0, 4], 4.0, 9)])
    return {"title": "Fixture Song", "duration": 12.0}, write_wav(out_dir / "audio.wav", y)


def fake_beats(wav_path, device="cpu"):
    beats = [i * 0.5 for i in range(24)]
    return {"beats": beats, "downbeats": beats[::4], "tempo": 120.0}


def run(tmp_path, monkeypatch, **opts):
    monkeypatch.setattr(pipeline.beats, "detect_beats", fake_beats)
    states = []
    timeline = analyze("vid00000001", tmp_path / "work", Options(**opts),
                       lambda s, p, m: states.append(s), fetch_audio=fake_fetch)
    return timeline, states


def test_fast_template_pipeline(tmp_path, monkeypatch):
    t, states = run(tmp_path, monkeypatch, mode="fast", engine="template")
    assert states == ["downloading", "beats", "chords", "bass", "key"]
    assert t["video_id"] == "vid00000001" and t["title"] == "Fixture Song"
    assert t["tempo"] == 120.0 and t["time_signature"] == 4
    assert t["engine"] == {"chords": "template", "separated": False, "version": "1"}
    assert t["warnings"] == []
    assert label_at(t["segments"], 2.0) == "C:maj"
    assert label_at(t["segments"], 6.0) == "G:maj/3"
    assert label_at(t["segments"], 10.0) == "A:min"
    beat_set = set(t["beats"])
    for s in t["segments"][1:]:
        assert s["start"] in beat_set
    assert all(s["edited"] is False and "bass" in s for s in t["segments"])
    assert t["key"] in ("C:maj", "A:min", "G:maj")


def test_missing_btc_weights_warns_and_falls_back(tmp_path, monkeypatch):
    t, _ = run(tmp_path, monkeypatch, mode="fast", engine="auto", weights_dir=tmp_path / "nothing")
    assert t["engine"]["chords"] == "template"
    assert "setup_models.py" in t["warnings"][0]


def test_cancel_reaches_running_separation(tmp_path, monkeypatch):
    def fake_separate(wav, out_dir, device=None, on_poll=None):
        on_poll()
        raise AssertionError("separation should have been cancelled")

    monkeypatch.setattr(pipeline.separate, "separate", fake_separate)
    calls = []

    def progress(state, pct, msg):
        calls.append(state)
        if calls.count("separating") > 1:
            raise pipeline.Cancelled()

    try:
        analyze("vid00000001", tmp_path / "w", Options(mode="accurate", engine="template"), progress,
                fetch_audio=fake_fetch)
    except pipeline.Cancelled:
        pass
    else:
        raise AssertionError("expected Cancelled")


def test_progress_callback_can_cancel(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline.beats, "detect_beats", fake_beats)

    def progress(state, pct, msg):
        if state == "beats":
            raise pipeline.Cancelled()

    try:
        analyze("vid00000001", tmp_path / "w", Options(engine="template"), progress, fetch_audio=fake_fetch)
    except pipeline.Cancelled:
        pass
    else:
        raise AssertionError("expected Cancelled")


def test_timeline_always_has_a_sections_list(tmp_path, monkeypatch):
    t, _ = run(tmp_path, monkeypatch, mode="fast", engine="template")
    assert t["sections"] == []  # the 12 s fixture is too short to split


def test_section_detection_failure_keeps_the_chords(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no structure")
    monkeypatch.setattr(pipeline.sections, "detect_sections", boom)
    t, _ = run(tmp_path, monkeypatch, mode="fast", engine="template")
    assert t["sections"] == [] and t["segments"]
    assert "Could not detect song sections" in t["warnings"][0]
