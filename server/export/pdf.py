"""PDF chord sheet, laid out like a lead sheet.

Bars are divided by bar lines (no boxes). A chord that lasts several beats is placed at its beat; beats
without a chord change get a dotted line, and a chord change gets a dashed divider. Sections start with a
lettered rehearsal mark in the section colour, the bar number sits above the first bar of every row, and one
chord size is used for the whole song so the player's eye never has to refocus.

Measurements follow the design spec (millimetres unless noted); see docs/pdf-chord-sheet-design-prompt.md.
"""
import datetime
import os
import re
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from server.export.grid import DISCLAIMER, ExportOptions, bar_segments, chord_legend, header, section_blocks

# ---------------------------------------------------------------- fonts

FONT_DIR = Path(__file__).parent / "fonts"
_FONT_FILES = {
    "Archivo-Regular": "Archivo-Regular.ttf",
    "Archivo-Medium": "Archivo-Medium.ttf",
    "Archivo-SemiBold": "Archivo-SemiBold.ttf",
    "Archivo-Bold": "Archivo-Bold.ttf",
    "Accidentals": "DejaVuSans-Bold-Accidentals.ttf",
}


def _register_fonts() -> dict[str, str]:
    """Register the bundled fonts; fall back to Helvetica if a file is missing so export never breaks."""
    names = {}
    for name, filename in _FONT_FILES.items():
        try:
            pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
            names[name] = name
        except Exception:  # noqa: BLE001 - any font problem must degrade, not fail the export
            names[name] = "Helvetica-Bold" if name in ("Archivo-Bold", "Archivo-SemiBold", "Accidentals") else "Helvetica"
    return names


_NAMES = _register_fonts()
F_REG, F_MED, F_SEMI, F_BOLD, F_ACC = (_NAMES[k] for k in ("Archivo-Regular", "Archivo-Medium", "Archivo-SemiBold", "Archivo-Bold", "Accidentals"))
F_ITALIC = "Helvetica-Oblique"

# ---------------------------------------------------------------- palette and measurements

INK = colors.HexColor("#231d17")
MUTED = colors.HexColor("#6f6458")
SOFT = colors.HexColor("#4a4037")
BASS = colors.HexColor("#0b7c86")
BEAT_LINE = colors.HexColor("#b9ad9c")
DIVIDER = colors.HexColor("#9c8f7a")
AMBER = colors.HexColor("#f2913d")
CREAM = colors.HexColor("#fbf5ea")

SECTION_COLORS = {
    "intro": "#f2c14e", "verse": "#6aa8e0", "chorus": "#f2913d",
    "bridge": "#b48be0", "interlude": "#ee8577", "outro": "#6fbf8b",
}
SECTION_PREFIXES = {
    "intro": "intro", "verse": "verse", "chorus": "chorus", "refrain": "chorus", "bridge": "bridge",
    "interlude": "interlude", "instrumental": "interlude", "solo": "interlude", "outro": "outro", "ending": "outro",
}

PAGE_W, PAGE_H = A4
MARGIN = 14 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
HEADER_H = 34 * mm
FOOTER_H = 10 * mm
BODY_TOP = MARGIN + HEADER_H + 6 * mm            # distances from the top of the page
BODY_BOTTOM = PAGE_H - MARGIN - FOOTER_H
BODY_TOP_NEXT = MARGIN + 12 * mm                  # pages after the first only carry a slim running head
BAR_H = 14 * mm
ROW_GAP = 3 * mm
HEADING_H = 8 * mm                               # mark row 6 + 2 to the first row
SECTION_GAP = 5 * mm
MAX_FS, MIN_FS = 20.0, 10.0
CHORD_PAD = 1.6 * mm
CHORD_BASELINE = 5.8 * mm                        # above the bottom of the bar
QUALITY_SCALE, BASS_SCALE = 0.62, 0.68
ACCIDENTALS = "♭♯♮"

_NOTE = r"[A-G][b#]?"
_CHORD_RE = re.compile(rf"^({_NOTE})(.*?)(?:/({_NOTE}))?$")


# ---------------------------------------------------------------- text helpers

def _owner() -> str:
    return os.environ.get("CHORDARIUM_PDF_OWNER", "Chordarium")


def _safe(text: str, font: str) -> str:
    """Replace characters the font does not have (e.g. Sinhala) so they print as ? instead of empty boxes."""
    face = getattr(pdfmetrics.getFont(font), "face", None)
    table = getattr(face, "charToGlyph", None)
    if not table:
        return text
    return "".join(ch if (ord(ch) in table or ch.isspace()) else "?" for ch in text)


def _note(name: str) -> str:
    """'Bb' -> 'B♭', 'F#' -> 'F♯' (Archivo has no accidentals, so they come from the accidentals font)."""
    return name.replace("b", "♭").replace("#", "♯") if len(name) > 1 else name


def _quality(text: str) -> str:
    text = re.sub(r"b(?=\d)", "♭", text).replace("#", "♯")
    return text.replace("dim", "°")


def _runs(text: str, font: str) -> list[tuple[str, str]]:
    runs: list[tuple[str, str]] = []
    for ch in text:
        f = F_ACC if ch in ACCIDENTALS or ch == "°" else font
        if runs and runs[-1][1] == f:
            runs[-1] = (runs[-1][0] + ch, f)
        else:
            runs.append((ch, f))
    return runs


def _pieces(text: str, font: str) -> list[tuple[str, str]]:
    """Runs of text with the font each is drawn in; unsupported characters become ? (accidentals are exempt)."""
    return [(run if f == F_ACC else _safe(run, f), f) for run, f in _runs(text, font)]


def _width(text: str, font: str, size: float) -> float:
    return sum(pdfmetrics.stringWidth(run, f, size) for run, f in _pieces(text, font))


def _draw(c, x: float, y: float, text: str, font: str, size: float, color=INK) -> float:
    """Draw text, switching to the accidentals font for ♭ ♯; returns the width drawn."""
    c.setFillColor(color)
    start = x
    for run, f in _pieces(text, font):
        c.setFont(f, size)
        c.drawString(x, y, run)
        x += pdfmetrics.stringWidth(run, f, size)
    return x - start


# ---------------------------------------------------------------- chord symbols

def _split(symbol: str) -> tuple[str, str, str]:
    """'Ebm7/Bb' -> ('E♭', 'm7', 'B♭'); 'N.C.' -> ('N.C.', '', '')."""
    m = _CHORD_RE.match(symbol)
    if not m:
        return symbol, "", ""
    root, quality, bass = m.groups()
    return _note(root), _quality(quality), _note(bass) if bass else ""


def _chord_width(symbol: str, size: float) -> float:
    root, quality, bass = _split(symbol)
    main = _width(root, F_BOLD, size) + _width(quality, F_SEMI, size * QUALITY_SCALE)
    return max(main, _width("/" + bass, F_BOLD, size * BASS_SCALE)) if bass else main


def _draw_chord(c, x: float, baseline: float, symbol: str, size: float) -> None:
    root, quality, bass = _split(symbol)
    if symbol == "N.C.":
        _draw(c, x, baseline, symbol, F_BOLD, size, MUTED)
        return
    advance = _draw(c, x, baseline, root, F_BOLD, size)
    if quality:  # raised a little, and set smaller
        _draw(c, x + advance + size * 0.03, baseline + size * 0.34, quality, F_SEMI, size * QUALITY_SCALE)
    if bass:  # on its own line, directly under the root
        _draw(c, x, baseline - size * 0.826, "/" + bass, F_BOLD, size * BASS_SCALE, BASS)


def _section_color(label: str) -> colors.Color:
    text = label.strip().lower()
    for prefix, kind in SECTION_PREFIXES.items():
        if text.startswith(prefix):
            return colors.HexColor(SECTION_COLORS[kind])
    return colors.HexColor("#d8cdbd")


# ---------------------------------------------------------------- layout

def _bar_fit(segments: list[tuple[str, int]], bar_w: float) -> float:
    """The largest chord size at which every chord in the bar fits its share of the bar."""
    beats = sum(n for _, n in segments)
    best = MAX_FS
    for symbol, n in segments:
        room = bar_w * n / beats - 2.8 * mm
        best = min(best, room / max(_chord_width(symbol, 1.0), 0.001))
    return best


def _plan(blocks, per_row: int):
    """Turn sections into rows of bars, wide bars where needed, and pick the single chord size for the song."""
    unit_w = CONTENT_W / per_row
    sizes: list[float] = []
    planned = []
    for label, bars in blocks:
        items = []
        for slots in bars:
            segments = bar_segments(slots)
            span = 1
            fs = _bar_fit(segments, unit_w)
            if per_row == 8 and fs < MIN_FS:  # too cramped at 1/8 of the page: give the bar two columns
                span = 2
                fs = _bar_fit(segments, unit_w * 2)
            sizes.append(fs)
            items.append((segments, span))
        rows: list[list[tuple[list[tuple[str, int]], int, int]]] = []
        row: list = []
        used = 0
        for segments, span in items:
            if used + span > per_row:
                rows.append(row)
                row, used = [], 0
            row.append((segments, span, used))
            used += span
        if row:
            rows.append(row)
        planned.append((label, rows, len(bars)))
    chord_size = max(MIN_FS, min(MAX_FS, min(sizes))) if sizes else MAX_FS
    return planned, chord_size, unit_w


# ---------------------------------------------------------------- drawing pieces

def _logo(c, x: float, top: float, size: float) -> None:
    """The Chordarium mark. (x, top) is its top-left corner in distance-from-top terms."""
    cx, cy, r = x + size / 2, PAGE_H - top - size / 2, size / 2
    c.setFillColor(INK)
    c.circle(cx, cy, r, stroke=0, fill=1)
    k = size / 100
    c.setStrokeColor(CREAM)
    c.setLineWidth(12 * k)
    c.setLineCap(1)
    c.arc(cx - 28 * k, cy - 28 * k, cx + 28 * k, cy + 28 * k, 51.4, 257.2)
    for dy, fill in ((11, AMBER), (0, CREAM), (-11, CREAM)):
        c.setFillColor(fill)
        c.circle(cx + 11 * k, cy + dy * k, 5.5 * k, stroke=0, fill=1)
    c.setLineCap(0)


def _header(c, h: dict) -> None:
    title = h["title"]
    max_w = CONTENT_W - 18 * mm
    if pdfmetrics.stringWidth(_safe(title, F_BOLD), F_BOLD, 22) <= max_w:
        lines, size, lead = [_safe(title, F_BOLD)], 22, 26
    else:
        lines = simpleSplit(_safe(title, F_BOLD), F_BOLD, 16, max_w)
        size, lead = 16, 19
        if len(lines) > 2:
            lines = lines[:2]
            while lines[1] and pdfmetrics.stringWidth(lines[1] + "...", F_BOLD, 16) > max_w:
                lines[1] = lines[1][:-1]
            lines[1] = lines[1].rstrip() + "..."
    top = MARGIN
    for i, line in enumerate(lines):
        _draw(c, MARGIN, PAGE_H - (top + (i * lead + (lead - size) / 2) + size * 0.8), line, F_BOLD, size)
    bottom = top + len(lines) * lead
    _logo(c, PAGE_W - MARGIN - 12 * mm, MARGIN, 12 * mm)

    key = re.sub(r"^([A-G])([b#])", lambda m: m.group(1) + ("♭" if m.group(2) == "b" else "♯"), h["key_text"])
    meta = f"Key {key} · {h['tempo']} BPM · {h['time_signature']}" + (f" · Capo {h['capo']}" if h["capo"] else "")
    meta_top = bottom + 3 * mm
    _draw(c, MARGIN, PAGE_H - (meta_top + 10 * 0.8), meta, F_MED, 10)
    note_top = meta_top + 10 * 1.2 + 1.5 * mm
    _draw(c, MARGIN, PAGE_H - (note_top + 8 * 0.8), DISCLAIMER, F_REG, 8, MUTED)
    c.setStrokeColor(INK)
    c.setLineWidth(0.75)
    c.line(MARGIN, PAGE_H - (MARGIN + HEADER_H), PAGE_W - MARGIN, PAGE_H - (MARGIN + HEADER_H))


def _running_head(c, h: dict) -> None:
    """A slim title line and rule at the top of every page after the first."""
    title = h["title"]
    while title and _width(title, F_MED, 8) > CONTENT_W - 30 * mm:
        title = title[:-1]
    if title != h["title"]:
        title = title.rstrip() + "..."
    _draw(c, MARGIN, PAGE_H - (MARGIN + 8 * 0.8), title, F_MED, 8, MUTED)
    c.setStrokeColor(BEAT_LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, PAGE_H - (MARGIN + 7 * mm), PAGE_W - MARGIN, PAGE_H - (MARGIN + 7 * mm))


def _footer(c) -> None:
    rule_y = PAGE_H - (PAGE_H - MARGIN - FOOTER_H)
    c.setStrokeColor(BEAT_LINE)
    c.setLineWidth(0.5)
    c.line(MARGIN, rule_y, PAGE_W - MARGIN, rule_y)
    base = MARGIN + 1.6 * mm
    _logo(c, MARGIN, PAGE_H - (base + 3.4 * mm), 4 * mm)
    _draw(c, MARGIN + 5.6 * mm, base, "Chordarium", F_BOLD, 8)
    text = f"© {datetime.date.today().year} {_owner()}. All rights reserved."
    _draw(c, (PAGE_W - _width(text, F_REG, 8)) / 2, base, text, F_REG, 8, MUTED)
    page = f"Page {c.getPageNumber()}"
    _draw(c, PAGE_W - MARGIN - _width(page, F_REG, 8), base, page, F_REG, 8, INK)


def _mark(c, top: float, letter: str, name: str, count: str, color) -> None:
    """Rehearsal mark: a lettered box in the section colour, the section name, and its bar count."""
    box_h = 5.5 * mm
    box_w = max(5.5 * mm, _width(letter, F_BOLD, 9) + 2 * mm)
    y = PAGE_H - (top + box_h)
    c.setFillColor(color)
    c.setStrokeColor(INK)
    c.setLineWidth(1)
    c.rect(MARGIN, y, box_w, box_h, stroke=1, fill=1)
    _draw(c, MARGIN + (box_w - _width(letter, F_BOLD, 9)) / 2, y + (box_h - 9 * 0.72) / 2, letter, F_BOLD, 9)
    _draw(c, MARGIN + box_w + 2 * mm, y + (box_h - 9 * 0.72) / 2, name, F_BOLD, 9)
    _draw(c, PAGE_W - MARGIN - _width(count, F_REG, 8), y + (box_h - 8 * 0.72) / 2, count, F_REG, 8, MUTED)


def _bar_line(c, x: float, top: float, kind: str) -> None:
    """A bar line; `double` closes a section, `end` is the thin-then-thick line that closes the song."""
    y0, y1 = PAGE_H - (top + 13 * mm), PAGE_H - (top + 1 * mm)
    c.setStrokeColor(INK)
    if kind == "end":
        c.setLineWidth(2)
        c.line(x, y0, x, y1)
        c.setLineWidth(0.6)
        c.line(x - 1.8 * mm, y0, x - 1.8 * mm, y1)
        return
    c.setLineWidth(0.6)
    c.line(x, y0, x, y1)
    if kind == "double":
        c.line(x - 0.8 * mm, y0, x - 0.8 * mm, y1)


def _bar(c, x: float, top: float, width: float, segments, chord_size: float, right: str | None, number: int | None) -> None:
    beats = sum(n for _, n in segments)
    inset_top, inset_bottom = PAGE_H - top, PAGE_H - (top + BAR_H)
    # beat lines and chord dividers
    starts = {sum(n for _, n in segments[:i]) for i in range(len(segments))}
    for beat in range(1, beats):
        bx = x + width * beat / beats
        if beat in starts:  # a chord change: dashed divider
            c.setStrokeColor(DIVIDER)
            c.setLineWidth(0.6)
            c.setDash(1.2 * mm, 1.2 * mm)
            c.line(bx, inset_top - 3.2 * mm, bx, inset_bottom + 3.2 * mm)
        else:  # a held beat: dotted guide
            c.setStrokeColor(BEAT_LINE)
            c.setLineWidth(0.5)
            c.setDash(0.5, 1.5)
            c.line(bx, inset_top - 4.2 * mm, bx, inset_bottom + 4.2 * mm)
        c.setDash()
    # chords
    beat_at = 0
    for symbol, n in segments:
        _draw_chord(c, x + width * beat_at / beats + CHORD_PAD, inset_bottom + CHORD_BASELINE, symbol, chord_size)
        beat_at += n
    _bar_line(c, x, top, "single")
    if right:
        _bar_line(c, x + width, top, right)
    if number is not None:
        c.setFillColor(MUTED)
        c.setFont(F_ITALIC, 6)
        c.drawString(x + 0.4 * mm, inset_top + 0.6 * mm, str(number))


def _legend(c, top: float, legend) -> None:
    c.setFillColor(INK)
    _draw(c, MARGIN, PAGE_H - (top + 10 * 0.8), "Chords in this song", F_BOLD, 10)
    col_gap = 4 * mm
    col_w = (CONTENT_W - 3 * col_gap) / 4
    y_top = top + 10 * 1.2 + 2.5 * mm
    for i, (symbol, notes) in enumerate(legend):
        col, row = i % 4, i // 4
        x = MARGIN + col * (col_w + col_gap)
        y = PAGE_H - (y_top + row * 5 * mm + 9 * 0.8)
        root, quality, bass = _split(symbol)
        size = 9.0
        notes_text = " ".join(_note(n) for n in notes)
        total = _chord_width(symbol, size) + 1.6 * mm + _width(notes_text, F_REG, size) + (_width(" bass " + bass, F_REG, size) if bass else 0)
        if total > col_w:
            size = max(6.0, size * col_w / total)
        advance = _draw(c, x, y, root, F_BOLD, size)
        if quality:
            advance += _draw(c, x + advance + size * 0.03, y + size * 0.3, quality, F_SEMI, size * 0.7) + size * 0.03
        if bass:
            advance += _draw(c, x + advance, y, "/" + bass, F_BOLD, size, BASS)
        advance += 1.6 * mm
        advance += _draw(c, x + advance, y, notes_text, F_REG, size, SOFT)
        if bass:
            _draw(c, x + advance, y, " bass " + bass, F_REG, size, BASS)


# ---------------------------------------------------------------- the export

def to_pdf(timeline: dict, opts: ExportOptions) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    h = header(timeline, opts)
    c.setTitle(h["title"])
    planned, chord_size, unit_w = _plan(section_blocks(timeline, opts), opts.bars_per_row)

    def new_page() -> float:
        _footer(c)
        c.showPage()
        _running_head(c, h)
        return BODY_TOP_NEXT

    _header(c, h)
    cursor = BODY_TOP
    number = 1            # song-wide bar number, printed above the first bar of each row
    letters = 0           # rehearsal marks A, B, C ... in song order
    last_row_bottom = BODY_TOP
    for s_index, (label, rows, count) in enumerate(planned):
        is_last_section = s_index == len(planned) - 1
        letter = ""
        if label:
            letter = chr(ord("A") + letters % 26)
            letters += 1
        color = _section_color(label) if label else INK
        remaining = list(rows)
        shown = 0          # bars of this section already drawn
        continued = False
        while remaining:
            # keep-with-next: a heading needs room for itself and its first row
            if cursor + (HEADING_H if label else 0) + BAR_H > BODY_BOTTOM:
                cursor = new_page()
            part_top = cursor
            if label:
                cursor += HEADING_H
            before = shown
            while remaining and cursor + BAR_H <= BODY_BOTTOM:
                row = remaining.pop(0)
                for r_index, (segments, span, unit) in enumerate(row):
                    last_in_row = unit + span == opts.bars_per_row
                    last_in_section = not remaining and r_index == len(row) - 1
                    if last_in_section and is_last_section:
                        right = "end"
                    elif last_in_section:
                        right = "double"
                    else:
                        right = "single" if last_in_row else None
                    _bar(c, MARGIN + unit * unit_w, cursor, span * unit_w, segments, chord_size, right,
                         number if r_index == 0 else None)
                    shown += 1
                number += len(row)
                last_row_bottom = cursor + BAR_H
                cursor += BAR_H + ROW_GAP
            if label:
                note = f"bars {before + 1}\u2013{shown} of {count}" if continued else f"{count} bars"
                _mark(c, part_top, letter, f"{label} (cont.)" if continued else label, note, color)
            continued = True
            if remaining:
                cursor = new_page()
        cursor += SECTION_GAP - ROW_GAP

    legend = chord_legend(timeline, opts)
    if legend and planned:
        top = last_row_bottom + 8 * mm
        if top + 30 * mm > BODY_BOTTOM:
            top = new_page()
        _legend(c, top, legend)

    _footer(c)
    c.save()
    return buf.getvalue()
