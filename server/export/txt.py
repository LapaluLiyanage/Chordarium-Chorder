"""Plain-text chord sheet export."""
from server.export.grid import DISCLAIMER, ExportOptions, chord_legend, grid_lines, header, section_blocks


def to_txt(timeline: dict, opts: ExportOptions) -> str:
    h = header(timeline, opts)
    meta = f"Key: {h['key_text']} | Tempo: {h['tempo']} BPM | Time: {h['time_signature']}"
    if h["capo"]:
        meta += f" | Capo: {h['capo']}"
    lines = [h["title"], "=" * len(h["title"]), meta, DISCLAIMER, ""]
    for label, bars in section_blocks(timeline, opts):
        if label:
            lines.append(f"[{label}]")
        lines += grid_lines(bars, opts.bars_per_row)
        lines.append("")
    lines.append("Chords: " + ", ".join(symbol for symbol, _ in chord_legend(timeline, opts)))
    return "\n".join(lines) + "\n"
