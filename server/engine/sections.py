"""Song structure: split a track into bar-aligned sections and name them (Intro, Verse 1, Chorus...).

Boundaries come from bar-level self-similarity (chroma + timbre). Sections that sound alike share a
group, and the group's role (repetition, loudness, vocals) decides its name. Every guess is
heuristic, so the labels are meant to be edited by the user.
"""
from collections import defaultdict

import librosa
import numpy as np

HOP = 512
MIN_BARS = 8                 # shorter songs are left as one unlabelled block
MIN_SECTION_BARS = 8
WINDOW_BARS = 8
BOUNDARY_FLOOR = 0.3
LONG_FLOOR = 0.7
GROUP_SIMILARITY = 0.45
NO_VOCAL_LEVEL = 0.25        # vocal loudness relative to the song's sung parts


def _bar_features(y: np.ndarray, sr: int, bar_times: list[float], vocal_y: np.ndarray | None):
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=13)[1:]
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    vocal_rms = librosa.feature.rms(y=vocal_y, hop_length=HOP)[0] if vocal_y is not None else None
    frames = librosa.time_to_frames(bar_times, sr=sr, hop_length=HOP)
    feats, energy, vocal = [], [], []
    for a, b in zip(frames[:-1], frames[1:]):
        b = max(b, a + 1)
        c = chroma[:, a:b].mean(axis=1)
        feats.append(np.concatenate([c / (np.linalg.norm(c) + 1e-9), 0.5 * mfcc[:, a:b].mean(axis=1)]))
        energy.append(float(rms[a:b].mean()))
        vocal.append(float(vocal_rms[a:b].mean()) if vocal_rms is not None else 0.0)
    x = np.array(feats)
    x = (x - x.mean(axis=0)) / (x.std(axis=0) + 1e-9)
    return x, np.array(energy), (np.array(vocal) if vocal_rms is not None else None)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def _boundaries(x: np.ndarray) -> list[int]:
    """Bar indices where a new section starts (always includes 0).

    A boundary is where the average sound of the next bars differs most from the previous bars.
    """
    n = len(x)
    short, long_ = np.zeros(n), np.zeros(n)
    for b in range(MIN_SECTION_BARS // 2, n - MIN_SECTION_BARS // 2 + 1):
        for out, w in ((short, WINDOW_BARS // 2), (long_, WINDOW_BARS)):
            out[b] = 1 - _cosine(x[max(0, b - w):b].mean(axis=0), x[b:min(n, b + w)].mean(axis=0))
    # the short window pins a boundary down; the long window must agree, which ignores one-off changes
    novelty = np.array([short[b] if long_[max(0, b - 2):b + 3].max() >= LONG_FLOOR else 0.0 for b in range(n)])
    floor = max(BOUNDARY_FLOOR, novelty.mean() + 0.25 * novelty.std())
    accepted: list[int] = [0]
    for b in sorted(range(1, n), key=lambda i: -novelty[i]):
        if novelty[b] < floor:
            break
        if novelty[b] < novelty[max(0, b - 3):b + 4].max():
            continue
        if all(abs(b - a) >= MIN_SECTION_BARS for a in accepted) and n - b >= MIN_SECTION_BARS:
            accepted.append(b)
    return sorted(accepted)


def _group(vectors: list[np.ndarray]) -> list[int]:
    groups: list[int] = []
    centroids: list[list[np.ndarray]] = []
    for v in vectors:
        best, best_sim = -1, GROUP_SIMILARITY
        for g, members in enumerate(centroids):
            s = _cosine(v, np.mean(members, axis=0))
            if s >= best_sim:
                best, best_sim = g, s
        if best < 0:
            centroids.append([v])
            groups.append(len(centroids) - 1)
        else:
            centroids[best].append(v)
            groups.append(best)
    return groups


def label_sections(segs: list[dict]) -> list[str]:
    """Names for sections given each one's start/end/group/energy and vocal level (None = unknown).

    Verse, Interlude and Bridge are numbered when they occur more than once; Chorus is not.
    """
    n = len(segs)
    if n == 0:
        return []
    total = segs[-1]["end"] - segs[0]["start"]
    count: dict[int, int] = defaultdict(int)
    for s in segs:
        count[s["group"]] += 1

    def silent(s: dict) -> bool:
        return s["vocal"] is not None and s["vocal"] < NO_VOCAL_LEVEL

    kinds: list[str | None] = [None] * n
    if n >= 3 and count[segs[0]["group"]] == 1 and (segs[0]["end"] - segs[0]["start"]) <= 0.2 * total \
            and (silent(segs[0]) or segs[0]["vocal"] is None):
        kinds[0] = "Intro"
    if n >= 4 and kinds[-1] is None and (silent(segs[-1]) or count[segs[-1]["group"]] == 1):
        kinds[-1] = "Outro"
    for i, s in enumerate(segs):
        if kinds[i] is None and silent(s):
            kinds[i] = "Interlude"

    open_idx = [i for i in range(n) if kinds[i] is None]
    repeated = {segs[i]["group"] for i in open_idx if sum(1 for j in open_idx if segs[j]["group"] == segs[i]["group"]) > 1}
    chorus_group = None
    if repeated:
        def loudness(g: int) -> float:
            members = [segs[i]["energy"] for i in open_idx if segs[i]["group"] == g]
            return sum(members) / len(members)
        chorus_group = max(repeated, key=loudness) if len(repeated) > 1 else None
        if chorus_group is None:
            # a single repeating group: the chorus unless a quieter unique section precedes it
            only = next(iter(repeated))
            chorus_group = only if any(segs[i]["group"] != only for i in open_idx) else None
    for i in open_idx:
        g = segs[i]["group"]
        if g == chorus_group:
            kinds[i] = "Chorus"
        elif g in repeated or segs[i]["start"] - segs[0]["start"] < 0.6 * total or chorus_group is None:
            kinds[i] = "Verse"
        else:
            kinds[i] = "Bridge"

    totals = defaultdict(int)
    for k in kinds:
        totals[k] += 1
    seen: dict[str, int] = defaultdict(int)
    names = []
    for k in kinds:
        seen[k] += 1
        names.append(f"{k} {seen[k]}" if totals[k] > 1 and k not in ("Chorus",) else k)
    return names


def detect_sections(y: np.ndarray, sr: int, downbeats: list[float], duration: float,
                    vocal_y: np.ndarray | None = None) -> list[dict]:
    """Bar-aligned sections [{start, end, label, uncertain}]; [] when the song is too short to split."""
    bar_times = list(downbeats)
    if not bar_times or len(bar_times) < MIN_BARS:
        return []
    bar_times = bar_times + [duration]
    x, energy, vocal = _bar_features(y, sr, bar_times, vocal_y)
    starts = _boundaries(x)
    spans = list(zip(starts, starts[1:] + [len(x)]))
    groups = _group([x[a:b].mean(axis=0) for a, b in spans])
    sung = None
    if vocal is not None:
        sung = max(float(np.percentile(vocal, 90)), 1e-9)
    segs = [{
        "start": bar_times[a], "end": bar_times[b], "group": g, "energy": float(energy[a:b].mean()),
        "vocal": float(vocal[a:b].mean() / sung) if sung is not None else None,
    } for (a, b), g in zip(spans, groups)]
    # the part before the first downbeat belongs to the first section
    segs[0]["start"] = 0.0
    names = label_sections(segs)
    return [{"start": round(s["start"], 3), "end": round(s["end"], 3), "label": name, "uncertain": vocal is None}
            for s, name in zip(segs, names)]
