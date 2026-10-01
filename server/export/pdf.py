"""PDF chord sheet: header, bar grid, chord legend."""
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from server.export.grid import DISCLAIMER, HOLD, ExportOptions, chord_legend, header, section_blocks

MARGIN = 18 * mm
ROW_H = 12 * mm
HEADING_H = 8 * mm
BASS_COLOR = colors.HexColor("#0b7c86")


def _draw_chord(c, x: float, y: float, slot: str) -> None:
    """Chord in black, its slash-bass note in the bass colour."""
    font = "Helvetica" if slot == HOLD else "Helvetica-Bold"
    chord, slash, bass = slot.partition("/")
    c.setFont(font, 12)
    c.setFillColor(colors.black)
    c.drawString(x, y, chord)
    if slash:
        c.setFillColor(BASS_COLOR)
        c.drawString(x + c.stringWidth(chord, font, 12), y, "/" + bass)
        c.setFillColor(colors.black)


def to_pdf(timeline: dict, opts: ExportOptions) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    h = header(timeline, opts)
    c.setTitle(h["title"])

    y = height - MARGIN
    c.setFont("Helvetica-Bold", 20)
    c.drawString(MARGIN, y, h["title"])
    y -= 9 * mm
    meta = f"Key: {h['key_text']}   {h['tempo']} BPM"
    if h["capo"]:
        meta += f"   Capo {h['capo']}"
    c.setFont("Helvetica", 11)
    c.drawString(MARGIN, y, meta)
    y -= 5 * mm
    c.setFont("Helvetica-Oblique", 9)
    c.setFillColor(colors.grey)
    c.drawString(MARGIN, y, DISCLAIMER)
    c.setFillColor(colors.black)
    y -= 9 * mm

    col_w = (width - 2 * MARGIN) / opts.bars_per_row
    for label, bars in section_blocks(timeline, opts):
        if label:
            if y < MARGIN + HEADING_H + ROW_H:
                c.showPage()
                y = height - MARGIN
            c.setFont("Helvetica-Bold", 13)
            c.drawString(MARGIN, y, label)
            y -= HEADING_H
        for i in range(0, len(bars), opts.bars_per_row):
            if y < MARGIN + ROW_H:
                c.showPage()
                y = height - MARGIN
            row = bars[i:i + opts.bars_per_row]
            for k, bar in enumerate(row):
                x = MARGIN + k * col_w
                c.line(x, y - ROW_H + 4 * mm, x, y + 3 * mm)
                slot_w = (col_w - 4) / len(bar)
                for n, slot in enumerate(bar):
                    _draw_chord(c, x + 3 + n * slot_w, y - 3 * mm, slot)
            end_x = MARGIN + len(row) * col_w
            c.line(end_x, y - ROW_H + 4 * mm, end_x, y + 3 * mm)
            y -= ROW_H
        y -= 3 * mm

    legend = chord_legend(timeline, opts)
    if legend:
        if y < MARGIN + 20 * mm:
            c.showPage()
            y = height - MARGIN
        y -= 4 * mm
        c.setFont("Helvetica-Bold", 12)
        c.drawString(MARGIN, y, "Chords")
        y -= 6 * mm
        c.setFont("Helvetica", 10)
        for symbol, notes in legend:
            if y < MARGIN:
                c.showPage()
                y = height - MARGIN
                c.setFont("Helvetica", 10)
            c.drawString(MARGIN, y, f"{symbol}:  {' '.join(notes)}")
            y -= 5 * mm

    c.save()
    return buf.getvalue()
