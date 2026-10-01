"""ChordPro (.cho) export: one labelled bar grid per song section."""
from server.export.grid import DISCLAIMER, ExportOptions, grid_lines, header, section_blocks


def to_chordpro(timeline: dict, opts: ExportOptions) -> str:
    h = header(timeline, opts)
    lines = [f"{{title: {h['title']}}}", f"{{key: {h['key_symbol']}}}", f"{{tempo: {h['tempo']}}}"]
    if h["capo"]:
        lines.append(f"{{capo: {h['capo']}}}")
    lines.append(f"# {DISCLAIMER}")
    for label, bars in section_blocks(timeline, opts):
        lines += ["", f"{{start_of_grid: {label}}}" if label else "{start_of_grid}",
                  *grid_lines(bars, opts.bars_per_row), "{end_of_grid}"]
    return "\n".join(lines) + "\n"
