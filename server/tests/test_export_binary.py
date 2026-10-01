from io import BytesIO

import mido
from pypdf import PdfReader

from server.export.grid import ExportOptions
from server.export.midi import to_midi
from server.export.pdf import to_pdf


def pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() for page in PdfReader(BytesIO(data)).pages)


def test_pdf_contains_header_grid_and_legend(timeline):
    # capo 2 turns Cm7 into Bbm7 and D7/F# into C7/E (shapes), header key stays sounding G minor
    data = to_pdf(timeline, ExportOptions(capo=2))
    assert data.startswith(b"%PDF")
    text = pdf_text(data)
    for expected in ["Test Song", "G minor", "120 BPM", "Capo 2", "Bbm7", "C7/E", "Bb Db F Ab"]:
        assert expected in text


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
