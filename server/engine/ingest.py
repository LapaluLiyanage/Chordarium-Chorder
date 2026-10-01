"""YouTube link -> mono 22.05 kHz WAV via yt-dlp + ffmpeg."""
import logging
import re
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

log = logging.getLogger(__name__)

MAX_DURATION = 900
SAMPLE_RATE = 22050
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}


class IngestError(Exception):
    """Raised with a message that is safe to show to the user."""


def parse_video_id(url: str) -> str | None:
    url = url.strip()
    if not url:
        return None
    if "://" not in url:
        url = "https://" + url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    candidate = None
    if host == "youtu.be":
        candidate = parsed.path.lstrip("/").split("/")[0]
    elif host in _YT_HOSTS:
        parts = [p for p in parsed.path.split("/") if p]
        if parts[:1] == ["watch"]:
            candidate = parse_qs(parsed.query).get("v", [None])[0]
        elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live"):
            candidate = parts[1]
    return candidate if candidate and _ID_RE.match(candidate) else None


def _watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _friendly(message: str) -> str:
    m = message.lower()
    if "private video" in m:
        return "This video is private."
    if "confirm your age" in m or "age-restricted" in m:
        return "This video is age-restricted and can't be downloaded."
    if "video unavailable" in m or "has been removed" in m:
        return "This video is unavailable or was removed."
    log.warning("yt-dlp could not fetch the video: %s", message.strip()[-400:])
    return ("Couldn't download this video. This is often temporary, so try again in a minute. "
            "If it keeps failing, update yt-dlp (pip install -U yt-dlp).")


def probe(video_id: str) -> dict:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(_watch_url(video_id), download=False)
    except DownloadError as e:
        raise IngestError(_friendly(str(e))) from e
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise IngestError("Live streams can't be analyzed.")
    duration = float(info.get("duration") or 0)
    if duration > MAX_DURATION:
        raise IngestError(f"This video is {int(duration // 60)} min long; the limit is 15 min.")
    return {"title": info.get("title") or video_id, "duration": duration}


def download_wav(video_id: str, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    opts = {"format": "bestaudio/best", "outtmpl": str(out_dir / "source.%(ext)s"),
            "quiet": True, "no_warnings": True, "noplaylist": True}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(_watch_url(video_id), download=True)
            source = Path(ydl.prepare_filename(info))
    except DownloadError as e:
        raise IngestError(_friendly(str(e))) from e
    wav = out_dir / "audio.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
                    "-ac", "1", "-ar", str(SAMPLE_RATE), str(wav)], check=True, capture_output=True)
    source.unlink(missing_ok=True)
    return wav


def fetch_audio(video_id: str, out_dir: Path) -> tuple[dict, Path]:
    meta = probe(video_id)
    return meta, download_wav(video_id, out_dir)
