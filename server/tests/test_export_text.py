import json

from server.export.chordpro import to_chordpro
from server.export.grid import ExportOptions, build_bars, chord_legend, grid_lines
from server.export.json_export import to_json
from server.export.txt import to_txt


def test_build_bars_marks_continuations(timeline):
    assert build_bars(timeline, ExportOptions()) == [
        ["Cm7", ".", ".", "."],
        ["F7", ".", ".", "."],
        ["Bbmaj7", ".", "Ebmaj7", "."],
        ["D7/F#", ".", ".", "."],
    ]


def test_transpose_capo_simplify(timeline):
    bars = build_bars(timeline, ExportOptions(transpose=2, capo=2, simplify=True))
    assert [b[0] for b in bars] == ["Cm", "F", "Bb", "D"]
    bars = build_bars(timeline, ExportOptions(transpose=1))
    assert bars[0][0] == "C#m7" and bars[3][0] == "D#7/G"


def test_borrowed_chords_use_flats_in_sharp_keys(timeline):
    timeline["key"] = "C:maj"
    timeline["segments"][0]["label"] = "A#:maj"
    timeline["segments"][1]["label"] = "D#:maj/3"
    bars = build_bars(timeline, ExportOptions())
    assert bars[0][0] == "Bb" and bars[1][0] == "Eb/G"
    assert dict(chord_legend(timeline, ExportOptions()))["Bb"] == ["Bb", "D", "F"]


def test_leading_and_trailing_silence_trimmed(timeline):
    timeline["duration"] = 12.0
    timeline["beats"] = [i * 0.5 for i in range(24)]
    timeline["downbeats"] = [0.0, 2.0, 4.0, 6.0, 8.0, 10.0]
    for s in timeline["segments"]:
        s["start"] += 2.0
        s["end"] += 2.0
    timeline["segments"].insert(0, {"start": 0.0, "end": 2.0, "label": "N", "alt": None,
                                    "confidence": 1.0, "bass": None, "edited": False})
    timeline["segments"].append({"start": 10.0, "end": 12.0, "label": "N", "alt": None,
                                 "confidence": 1.0, "bass": None, "edited": False})
    bars = build_bars(timeline, ExportOptions())
    assert bars[0][0] == "Cm7" and bars[-1][0] == "D7/F#" and len(bars) == 4


def test_missing_downbeats_fall_back_to_every_fourth_beat(timeline):
    timeline["downbeats"] = []
    assert len(build_bars(timeline, ExportOptions())) == 4


def test_grid_lines_wrap_rows():
    bars = [["C", "."], ["G", "."], ["Am", "."]]
    assert grid_lines(bars, 2) == ["| C . | G . |", "| Am . |"]


def test_chord_legend(timeline):
    legend = dict(chord_legend(timeline, ExportOptions()))
    assert legend["Cm7"] == ["C", "Eb", "G", "Bb"]
    assert legend["D7/F#"] == ["D", "F#", "A", "C"]


def test_chordpro_grid(timeline):
    assert to_chordpro(timeline, ExportOptions(capo=0)) == (
        "{title: Test Song}\n"
        "{key: Gm}\n"
        "{tempo: 120}\n"
        "# Chords and sections were detected automatically and may contain errors.\n"
        "\n"
        "{start_of_grid}\n"
        "| Cm7 . . . | F7 . . . | Bbmaj7 . Ebmaj7 . | D7/F# . . . |\n"
        "{end_of_grid}\n"
    )
    assert "{capo: 3}" in to_chordpro(timeline, ExportOptions(capo=3))


def test_txt(timeline):
    text = to_txt(timeline, ExportOptions(bars_per_row=2))
    assert text.splitlines()[:5] == [
        "Test Song",
        "=========",
        "Key: G minor | Tempo: 120 BPM",
        "Chords and sections were detected automatically and may contain errors.",
        "",
    ]
    assert "| Cm7 . . . | F7 . . . |" in text
    assert text.rstrip().endswith("Chords: Cm7, F7, Bbmaj7, Ebmaj7, D7/F#")


def test_json_round_trips(timeline):
    assert json.loads(to_json(timeline, ExportOptions())) == timeline


def with_sections(timeline):
    # the fixture has 4 bars of 2 s: split into an intro (bars 1-2) and a chorus (bars 3-4)
    timeline["sections"] = [
        {"start": 0.0, "end": 4.0, "label": "Intro", "uncertain": False},
        {"start": 4.0, "end": 8.0, "label": "Chorus", "uncertain": False},
    ]
    return timeline


def test_txt_groups_bars_under_section_headings(timeline):
    text = to_txt(with_sections(timeline), ExportOptions())
    assert text.index("[Intro]") < text.index("[Chorus]")
    assert "| Cm7 . . . | F7 . . . |" in text.split("[Chorus]")[0]
    assert "Bbmaj7" not in text.split("[Chorus]")[0]
    assert "may contain errors" in text


def test_chordpro_labels_each_section_grid(timeline):
    cho = to_chordpro(with_sections(timeline), ExportOptions())
    assert "{start_of_grid: Intro}" in cho and "{start_of_grid: Chorus}" in cho
    assert cho.count("{end_of_grid}") == 2
    assert "# Chords and sections were detected automatically" in cho


def test_songs_without_sections_export_one_block(timeline):
    assert to_txt(timeline, ExportOptions()).count("[") == 0
    assert to_chordpro(timeline, ExportOptions()).count("{start_of_grid}") == 1
