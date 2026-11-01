import pytest
from yt_dlp.utils import DownloadError

from server.engine import ingest
from server.engine.ingest import IngestError, parse_video_id

VID = "dQw4w9WgXcQ"


@pytest.mark.parametrize("url", [
    f"https://www.youtube.com/watch?v={VID}",
    f"https://youtube.com/watch?v={VID}&t=42s&list=PL123",
    f"https://www.youtube.com/watch?feature=share&v={VID}",
    f"https://youtu.be/{VID}?si=abcDEF",
    f"https://www.youtube.com/shorts/{VID}",
    f"https://music.youtube.com/watch?v={VID}&feature=share",
    f"https://m.youtube.com/watch?v={VID}",
    f"youtube.com/watch?v={VID}",
    f"  https://www.youtube.com/embed/{VID}  ",
])
def test_parse_video_id_variants(url):
    assert parse_video_id(url) == VID


@pytest.mark.parametrize("url", ["", "hello", "https://vimeo.com/123",
                                 "https://www.youtube.com/watch?v=short", "https://youtu.be/"])
def test_parse_video_id_rejects(url):
    assert parse_video_id(url) is None


class FakeYDL:
    info: dict = {}
    error: str | None = None

    def __init__(self, opts):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download=False):
        if FakeYDL.error:
            raise DownloadError(FakeYDL.error)
        return FakeYDL.info


@pytest.fixture
def fake_ydl(monkeypatch):
    FakeYDL.info, FakeYDL.error = {}, None
    monkeypatch.setattr(ingest, "YoutubeDL", FakeYDL)
    return FakeYDL


def test_probe_ok(fake_ydl):
    fake_ydl.info = {"title": "Song", "duration": 200, "live_status": "not_live"}
    assert ingest.probe(VID) == {"title": "Song", "duration": 200.0}


@pytest.mark.parametrize("info,msg", [
    ({"title": "x", "duration": 0, "is_live": True}, "Live streams"),
    ({"title": "x", "duration": 1200}, "limit is 15 min"),
])
def test_probe_rejects(fake_ydl, info, msg):
    fake_ydl.info = info
    with pytest.raises(IngestError, match=msg):
        ingest.probe(VID)


@pytest.mark.parametrize("err,msg", [
    ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "private"),
    ("ERROR: [youtube] x: Sign in to confirm your age", "age-restricted"),
    ("ERROR: [youtube] x: Video unavailable", "unavailable"),
    ("ERROR: something new broke", "pip install -U yt-dlp"),
])
def test_probe_maps_errors(fake_ydl, err, msg):
    fake_ydl.error = err
    with pytest.raises(IngestError, match=msg):
        ingest.probe(VID)


def test_upload_ids_are_content_hashes():
    a, b = ingest.upload_id(b"one"), ingest.upload_id(b"two")
    assert a != b and a == ingest.upload_id(b"one")
    assert ingest.is_upload_id(a) and not ingest.is_upload_id(VID) and not ingest.is_upload_id("file-../x")


@pytest.mark.parametrize("name,title", [
    ("My_Song - Live.mp3", "My Song - Live"),
    (r"C:\Music\track.flac", "track"),
    ("___.mp3", "Uploaded song"),
])
def test_title_from_filename(name, title):
    assert ingest.title_from_filename(name) == title


def _tone(path, seconds):
    import numpy as np
    import soundfile as sf
    sr = 22050
    t = np.arange(int(sr * seconds)) / sr
    sf.write(path, 0.3 * np.sin(2 * np.pi * 440 * t), sr)


def test_convert_file_makes_wav_and_mp3(tmp_path):
    _tone(tmp_path / "in.wav", 6)
    wav, mp3 = ingest.convert_file(tmp_path / "in.wav", tmp_path / "out")
    assert wav.stat().st_size > 0 and mp3.read_bytes()[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")


def test_convert_file_rejects_unreadable_and_short_files(tmp_path):
    (tmp_path / "junk.mp3").write_bytes(b"not audio at all")
    with pytest.raises(IngestError, match="Couldn't read"):
        ingest.convert_file(tmp_path / "junk.mp3", tmp_path / "a")
    _tone(tmp_path / "short.wav", 1)
    with pytest.raises(IngestError, match="too short"):
        ingest.convert_file(tmp_path / "short.wav", tmp_path / "b")
