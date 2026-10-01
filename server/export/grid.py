"""Shared bar/beat grid used by every chord-sheet exporter."""
import bisect
from dataclasses import dataclass

from server.theory import chord as ch

NO_CHORD = "N.C."
HOLD = "."


@dataclass(frozen=True)
class ExportOptions:
    transpose: int = 0
    capo: int = 0
    simplify: bool = False
    bars_per_row: int = 4


def _shape_shift(opts: ExportOptions) -> int:
    return opts.transpose - opts.capo


def _tonic(timeline: dict, opts: ExportOptions) -> str:
    return ch.key_spelling(timeline["key"], _shape_shift(opts))


def _label_at(segments: list[dict], starts: list[float], t: float) -> str:
    i = bisect.bisect_right(starts, t) - 1
    if i >= 0 and segments[i]["start"] <= t < segments[i]["end"]:
        return segments[i]["label"]
    return "N"


DISCLAIMER = "Chords and sections were detected automatically and may contain errors."


def _timed_bars(timeline: dict, opts: ExportOptions) -> list[tuple[float, list[str]]]:
    beats = timeline["beats"]
    downbeats = timeline["downbeats"] or beats[::timeline.get("time_signature", 4)]
    if not beats or not downbeats:
        return []
    segments = timeline["segments"]
    starts = [s["start"] for s in segments]
    tonic = _tonic(timeline, opts)
    bounds = list(downbeats) + [timeline["duration"]]
    bars, prev = [], None
    for i in range(len(downbeats)):
        start, end = bounds[i], bounds[i + 1]
        bar_beats = [b for b in beats if start - 1e-6 <= b < end - 1e-6] or [start]
        slots = []
        for j, beat in enumerate(bar_beats):
            symbol = ch.render(_label_at(segments, starts, beat + 0.01), transpose_by=opts.transpose,
                               capo=opts.capo, simplify_chord=opts.simplify, tonic=tonic)
            slots.append(symbol if j == 0 or symbol != prev else HOLD)
            prev = symbol
        bars.append((start, slots))

    def empty(bar: tuple[float, list[str]]) -> bool:
        return all(s in (NO_CHORD, HOLD) for s in bar[1])

    while bars and empty(bars[0]):
        bars.pop(0)
    while bars and empty(bars[-1]):
        bars.pop()
    return bars


def build_bars(timeline: dict, opts: ExportOptions) -> list[list[str]]:
    return [slots for _, slots in _timed_bars(timeline, opts)]


def section_blocks(timeline: dict, opts: ExportOptions) -> list[tuple[str | None, list[list[str]]]]:
    """Bars grouped under their section label; one unlabelled block when the song has no sections."""
    bars = _timed_bars(timeline, opts)
    sections = sorted(timeline.get("sections") or [], key=lambda s: s["start"])
    if not sections:
        return [(None, [slots for _, slots in bars])] if bars else []
    blocks: list[tuple[str | None, list[list[str]]]] = []
    for start, slots in bars:
        owner = None
        for sec in sections:
            if sec["start"] - 1e-6 <= start < sec["end"] - 1e-6:
                owner = sec["label"]
        if not blocks or blocks[-1][0] != owner:
            blocks.append((owner, []))
        blocks[-1][1].append(slots)
    return blocks


def grid_lines(bars: list[list[str]], per_row: int) -> list[str]:
    lines = []
    for i in range(0, len(bars), per_row):
        row = bars[i:i + per_row]
        lines.append("| " + " | ".join(" ".join(bar) for bar in row) + " |")
    return lines


def chord_legend(timeline: dict, opts: ExportOptions) -> list[tuple[str, list[str]]]:
    tonic = _tonic(timeline, opts)
    seen: dict[str, list[str]] = {}
    for seg in timeline["segments"]:
        c = ch.parse(seg["label"])
        if c is None:
            continue
        if opts.simplify:
            c = ch.simplify(c)
        c = ch.transpose(c, _shape_shift(opts))
        symbol = ch.format_symbol(c, tonic=tonic)
        if symbol not in seen:
            seen[symbol] = ch.note_names(c, tonic=tonic)
    return list(seen.items())


def header(timeline: dict, opts: ExportOptions) -> dict:
    return {
        "title": timeline["title"],
        "key_text": ch.format_key(timeline["key"], opts.transpose),
        "key_symbol": ch.key_symbol(timeline["key"], opts.transpose),
        "tempo": round(timeline["tempo"]),
        "capo": opts.capo,
    }
