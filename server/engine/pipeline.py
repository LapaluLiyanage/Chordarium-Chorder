"""YouTube video id -> chord timeline, reporting progress along the way."""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import librosa
import soundfile as sf

from server.engine import bass, beats, chords_btc, chords_tmpl, ingest, key, sections, separate, snap
from server.engine.chords_btc import DEFAULT_WEIGHTS_DIR

SR = 22050
ENGINE_VERSION = "1"
ProgressFn = Callable[[str, int, str], None]
MISSING_WEIGHTS_WARNING = ("BTC model weights not found, so the simpler template recognizer was used. "
                           "Run `python scripts/setup_models.py` for better accuracy.")


class Cancelled(Exception):
    pass


@dataclass
class Options:
    mode: str = "fast"            # "fast" | "accurate"
    engine: str = "auto"          # "auto" | "btc" | "template"
    weights_dir: Path = field(default_factory=lambda: DEFAULT_WEIGHTS_DIR)


def analyze(video_id: str, work_dir: Path, options: Options, progress: ProgressFn,
            fetch_audio=ingest.fetch_audio) -> dict:
    work_dir.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []

    progress("downloading", 5, "Downloading audio")
    meta, wav = fetch_audio(video_id, work_dir)
    y, _ = librosa.load(str(wav), sr=SR, mono=True)
    harmonic_y, bass_y, harmonic_path, separated = y, y, wav, False
    vocal_y = None

    if options.mode == "accurate":
        message = "Separating vocals, drums and bass (the slow part)"
        progress("separating", 15, message)
        stems = separate.separate(wav, work_dir / "stems", on_poll=lambda: progress("separating", 15, message))
        harmonic_y = separate.load_mix([stems["bass"], stems["other"]], SR)
        bass_y, _ = librosa.load(str(stems["bass"]), sr=SR, mono=True)
        vocal_y, _ = librosa.load(str(stems["vocals"]), sr=SR, mono=True)
        harmonic_path = work_dir / "harmonic.wav"
        sf.write(harmonic_path, harmonic_y, SR)
        separated = True

    progress("beats", 45, "Detecting beats")
    beat_info = beats.detect_beats(wav)

    progress("chords", 60, "Recognizing chords")
    if options.engine != "template" and chords_btc.is_available(options.weights_dir):
        segments = chords_btc.recognize(harmonic_path, options.weights_dir)
        engine_name = "btc-large"
    else:
        if options.engine != "template":
            warnings.append(MISSING_WEIGHTS_WARNING)
        segments = chords_tmpl.recognize(harmonic_y, SR)
        engine_name = "template"

    progress("bass", 80, "Detecting bass notes and inversions")
    segments = snap.snap_segments(segments, beat_info["beats"])
    segments = bass.apply_inversions(segments, bass.bass_pitch_classes(bass_y, SR, segments))
    segments = [{**s, "edited": False} for s in snap.merge_identical(segments)]

    progress("key", 92, "Estimating key")
    key_label = key.estimate_key(harmonic_y, SR)

    duration = round(len(y) / SR, 3)
    try:
        song_sections = sections.detect_sections(y, SR, beat_info["downbeats"], duration, vocal_y)
    except Exception as e:  # structure is a bonus: never lose the chords because of it
        song_sections = []
        warnings.append(f"Could not detect song sections: {e}")

    return {
        "video_id": video_id,
        "title": meta["title"],
        "duration": duration,
        "key": key_label,
        "tempo": beat_info["tempo"],
        "time_signature": 4,
        "beats": beat_info["beats"],
        "downbeats": beat_info["downbeats"],
        "segments": segments,
        "sections": song_sections,
        "engine": {"chords": engine_name, "separated": separated, "version": ENGINE_VERSION},
        "warnings": warnings,
    }
