from io import BytesIO

import mido
from pypdf import PdfReader

from server.export.grid import ExportOptions
from server.export.midi import to_midi
from server.export.pdf import to_pdf


def pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(BytesIO(data)).pages)


def squashed(data: bytes) -> str:
    """The PDF's text with all whitespace removed: the sheet draws a chord's root, quality and bass separately."""
    return "".join(pdf_text(data).split())


def test_pdf_contains_header_grid_and_legend(timeline):
    # capo 2 turns Cm7 into Bbm7 and D7/F# into C7/E (shapes), header key stays sounding G minor
    data = to_pdf(timeline, ExportOptions(capo=2))
    assert data.startswith(b"%PDF")
    text = squashed(data)
    # flats and sharps are printed as real ♭ ♯ signs
    for expected in ["TestSong", "Gminor", "120BPM", "4/4", "Capo2", "B♭m7", "C7/E", "B♭D♭FA♭", "Chordsinthissong"]:
        assert expected in text, expected


def test_pdf_paginates_long_songs(timeline):
    seg = timeline["segments"][0]
    timeline["duration"] = 400.0
    timeline["beats"] = [i * 0.5 for i in range(800)]
    timeline["downbeats"] = timeline["beats"][::4]
    timeline["segments"] = [{**seg, "start": 0.0, "end": 400.0}]
    assert len(PdfReader(BytesIO(to_pdf(timeline, ExportOptions()))).pages) >= 2


def first_chord_notes(data: bytes) -> set[int]:
    mid = mido.MidiFile(file=BytesIO(data))
    notes, tick = set(), 0
    for msg in mid.tracks[0]:
        tick += msg.time
        if msg.type == "note_on" and msg.velocity > 0 and tick == 0:
            notes.add(msg.note)
    return notes


def test_midi_first_chord_and_transpose(timeline):
    assert first_chord_notes(to_midi(timeline, ExportOptions())) == {36, 60, 63, 67, 70}
    assert first_chord_notes(to_midi(timeline, ExportOptions(transpose=2))) == {38, 62, 65, 69, 72}
    assert first_chord_notes(to_midi(timeline, ExportOptions(capo=5))) == {36, 60, 63, 67, 70}


def test_midi_accepts_non_latin_titles(timeline):
    timeline["title"] = "ගීතය 曲 🎸"
    assert first_chord_notes(to_midi(timeline, ExportOptions())) == {36, 60, 63, 67, 70}


def test_midi_tempo_and_length(timeline):
    mid = mido.MidiFile(file=BytesIO(to_midi(timeline, ExportOptions())))
    tempos = [m.tempo for m in mid.tracks[0] if m.type == "set_tempo"]
    assert tempos == [mido.bpm2tempo(120.0)]
    assert abs(mid.length - 8.0) < 0.05


def test_pdf_shows_section_headings_disclaimer_and_bass_colour(timeline):
    timeline["sections"] = [{"start": 0.0, "end": 4.0, "label": "Verse 1", "uncertain": True},
                            {"start": 4.0, "end": 8.0, "label": "Chorus", "uncertain": True}]
    data = to_pdf(timeline, ExportOptions())
    text = pdf_text(data)
    assert "Verse 1" in text and "Chorus" in text and "may contain errors" in text
    stream = PdfReader(BytesIO(data)).pages[0].get_contents().get_data()
    assert b".043137 .486275 .52549 rg" in stream  # the bass-note colour (#0b7c86)


def test_pdf_sheet_has_rehearsal_marks_bar_numbers_and_footer(timeline):
    timeline["sections"] = [{"start": 0.0, "end": 4.0, "label": "Intro", "uncertain": False},
                            {"start": 4.0, "end": 8.0, "label": "Chorus", "uncertain": False}]
    data = to_pdf(timeline, ExportOptions())
    text = pdf_text(data)
    assert "A" in text.split() and "B" in text.split()  # rehearsal marks in song order
    assert "Intro" in text and "Chorus" in text and "2 bars" in text
    assert "1" in text.split() and "3" in text.split()  # bar numbers above the first bar of each row
    assert "Chordarium" in text and "Page 1" in text and "All rights reserved" in text


def test_pdf_handles_long_titles_and_unsupported_characters(timeline):
    timeline["title"] = "A very long title " * 12 + "ගීතය"
    data = to_pdf(timeline, ExportOptions())
    assert data.startswith(b"%PDF") and "..." in pdf_text(data)


def test_pdf_continuation_pages_repeat_the_section_mark(timeline):
    seg = timeline["segments"][0]
    timeline["duration"] = 400.0
    timeline["beats"] = [i * 0.5 for i in range(800)]
    timeline["downbeats"] = timeline["beats"][::4]
    timeline["segments"] = [{**seg, "start": 0.0, "end": 400.0}]
    timeline["sections"] = [{"start": 0.0, "end": 400.0, "label": "Verse 1", "uncertain": False}]
    text = pdf_text(to_pdf(timeline, ExportOptions()))
    assert "Verse 1 (cont.)" in text and "of 200" in text


def test_pdf_uses_one_chord_size_for_the_whole_song(timeline):
    from server.export.pdf import _plan
    from server.export.grid import section_blocks
    _, size, _ = _plan(section_blocks(timeline, ExportOptions()), 4)
    assert 10 <= size <= 20
