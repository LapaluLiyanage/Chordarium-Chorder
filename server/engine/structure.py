"""Song sections from SongFormer, a pre-trained music structure model (Accurate mode).

SongFormer (ASLP-lab, CC BY 4.0) listens to the whole mix and returns labelled parts: intro, verse,
chorus, bridge, pre-chorus, instrumental, outro. Its time stamps are snapped to bars here so the
sections line up with the chord sheet. Without the weights, or if the model fails, the app uses the
repetition-based detector in sections.py instead.
"""
import logging
import os
import sys
import types
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

FRONTEND_REPO = "facebook/wav2vec2-conformer-rope-large-960h-ft"  # its config.json is read when the model is built
DIRNAME = "SongFormer"
WEIGHTS_FILE = "model.safetensors"
INPUT_SR = 24000          # the model's expected sampling rate
MIN_SECTION_BARS = 2      # shorter parts after snapping are merged into their neighbour
KINDS = {
    "intro": "Intro", "verse": "Verse", "chorus": "Chorus", "bridge": "Bridge",
    "inst": "Interlude", "outro": "Outro", "pre-chorus": "Pre-chorus", "prechorus": "Pre-chorus",
}
UNNUMBERED = ("Chorus", "Pre-chorus")
_model = None


def is_available(weights_dir: Path) -> bool:
    return (Path(weights_dir) / DIRNAME / WEIGHTS_FILE).is_file()


def _cache_frontend_config() -> None:
    """The model reads a small config from the Hugging Face hub; keep a copy so it can then run offline."""
    try:
        from huggingface_hub import hf_hub_download
        hf_hub_download(FRONTEND_REPO, "config.json")
    except Exception as e:  # already cached, or the model fails later with a clear message
        log.info("Could not refresh the SongFormer front-end config: %s", e)


def _load(weights_dir: Path):
    global _model
    if _model is not None:
        return _model
    local = str(Path(weights_dir) / DIRNAME)
    # the model code imports a metrics package that is only used when training
    if "msaf" not in sys.modules:
        msaf = types.ModuleType("msaf")
        msaf_eval = types.ModuleType("msaf.eval")
        msaf_eval.compute_results = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("training only"))
        msaf.eval = msaf_eval
        sys.modules["msaf"], sys.modules["msaf.eval"] = msaf, msaf_eval
    if local not in sys.path:
        sys.path.insert(0, local)
    os.environ["SONGFORMER_LOCAL_DIR"] = local
    _cache_frontend_config()
    # every file is local now; without this the model's config step retries network calls for minutes
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    import torch
    from transformers import AutoModel
    model = AutoModel.from_pretrained(local, trust_remote_code=True, low_cpu_mem_usage=False)
    model.eval()
    try:  # int8 weights in the linear layers: about 30% faster on a CPU with the same sections
        model = torch.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)
    except Exception as e:
        log.warning("Could not compress SongFormer, running it at full precision: %s", e)
    _model = model
    return model


def predict(wav_path: Path, weights_dir: Path) -> list[dict]:
    """The model's own parts: [{start, end, label}] with labels such as "verse" or "inst"."""
    import librosa
    audio, _ = librosa.load(str(wav_path), sr=INPUT_SR, mono=True)
    model = _load(weights_dir)
    return model(audio.astype(np.float32))


def number_kinds(kinds: list[str]) -> list[str]:
    """Verse, Bridge, Interlude and the like get 1, 2, ... when they occur more than once; Chorus never does."""
    totals: dict[str, int] = {}
    for k in kinds:
        totals[k] = totals.get(k, 0) + 1
    seen: dict[str, int] = {}
    names = []
    for k in kinds:
        seen[k] = seen.get(k, 0) + 1
        names.append(f"{k} {seen[k]}" if totals[k] > 1 and k not in UNNUMBERED else k)
    return names


def to_sections(parts: list[dict], downbeats: list[float], duration: float) -> list[dict]:
    """Bar-aligned sections [{start, end, label, uncertain}] from the model's parts; [] if there are none."""
    bars = list(downbeats) + [duration]
    if len(bars) < 3 or not parts:
        return []

    def snap(t: float) -> int:
        return int(np.argmin([abs(b - t) for b in bars]))

    # model parts -> (first bar, kind), dropping silence and joining neighbours that share a kind
    marks: list[tuple[int, str]] = []
    for part in sorted(parts, key=lambda p: p["start"]):
        kind = KINDS.get(str(part["label"]).lower())
        if kind is None:
            continue
        bar = 0 if not marks else snap(part["start"])
        if marks and bar <= marks[-1][0]:
            marks[-1] = (marks[-1][0], kind)  # the earlier part snapped to zero length: the later one wins
            continue
        if marks and kind == marks[-1][1]:
            continue
        marks.append((bar, kind))
    if not marks:
        return []
    marks[0] = (0, marks[0][1])

    # a part shorter than a couple of bars is a blip: let the part before it take over
    merged: list[tuple[int, str]] = []
    for i, (bar, kind) in enumerate(marks):
        end_bar = marks[i + 1][0] if i + 1 < len(marks) else len(bars) - 1
        if merged and end_bar - bar < MIN_SECTION_BARS:
            continue
        if merged and merged[-1][1] == kind:
            continue
        merged.append((bar, kind))
    merged[0] = (0, merged[0][1])

    names = number_kinds([kind for _, kind in merged])
    out = []
    for i, ((bar, _), name) in enumerate(zip(merged, names)):
        start = 0.0 if i == 0 else bars[bar]
        end = duration if i + 1 == len(merged) else bars[merged[i + 1][0]]
        out.append({"start": round(start, 3), "end": round(end, 3), "label": name, "uncertain": False})
    return out
