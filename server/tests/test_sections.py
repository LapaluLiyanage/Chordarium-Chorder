import numpy as np

from server.engine.sections import detect_sections, label_sections
from server.tests.synth import SR, chord_audio

BAR = 2.0
SECTION_BARS = 8
C, D, E, F, G, A = 0, 2, 4, 5, 7, 9
VERSE = [[C, E, G], [A, C + 12, E + 12], [F, A, C + 12], [G, 11, D + 12]]
CHORUS = [[D, F, A], [10, D + 12, F + 12], [C, E, G], [G, 11, D + 12]]
INTRO = [[E, G, 11]] * 4
OUTRO = [[6, 10, 13]] * 4  # F# major: unlike anything in the verse or chorus


def bars(progression, gain):
    # a four-chord progression played twice fills an 8-bar section, as in most songs
    return np.concatenate([gain * chord_audio([p % 12 for p in pcs], BAR) for pcs in progression * 2])


def song():
    parts = [("intro", INTRO, 0.4), ("verse", VERSE, 0.5), ("chorus", CHORUS, 1.0),
             ("verse", VERSE, 0.5), ("chorus", CHORUS, 1.0), ("outro", OUTRO, 0.4)]
    y = np.concatenate([bars(p, g) for _, p, g in parts]).astype(np.float32)
    vocal = np.concatenate([
        np.zeros(int(SECTION_BARS * BAR * SR)) if name in ("intro", "outro") else 0.3 * np.sin(np.linspace(0, 8000, int(SECTION_BARS * BAR * SR)))
        for name, _, _ in parts]).astype(np.float32)
    downbeats = [i * BAR for i in range(6 * SECTION_BARS)]
    return y, vocal, downbeats, 6 * SECTION_BARS * BAR


def assert_starts(sections):
    expected = [i * SECTION_BARS * BAR for i in range(6)]
    assert len(sections) == 6
    assert all(abs(s["start"] - e) <= BAR for s, e in zip(sections, expected))  # within one bar


def test_detects_and_names_a_pop_structure_with_vocals():
    y, vocal, downbeats, duration = song()
    sections = detect_sections(y, SR, downbeats, duration, vocal_y=vocal)
    assert [s["label"] for s in sections] == ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Outro"]
    assert_starts(sections)
    assert sections[-1]["end"] == duration
    assert not any(s["uncertain"] for s in sections)


def test_without_vocals_labels_are_marked_uncertain():
    y, _, downbeats, duration = song()
    sections = detect_sections(y, SR, downbeats, duration)
    assert sections and all(s["uncertain"] for s in sections)
    assert_starts(sections)
    assert sections[0]["label"] == "Intro" and sections[-1]["label"] == "Outro"
    assert sections[2]["label"] == "Chorus"


def test_short_songs_are_not_split():
    y = bars(VERSE, 0.5)
    assert detect_sections(y, SR, [i * BAR for i in range(4)], 4 * BAR) == []


def seg(start, end, group, energy=1.0, vocal=1.0):
    return {"start": start, "end": end, "group": group, "energy": energy, "vocal": vocal}


def test_instrumental_middle_section_is_an_interlude():
    names = label_sections([
        seg(0, 8, 0, vocal=0.0), seg(8, 24, 1), seg(24, 40, 2, energy=2.0), seg(40, 48, 3, vocal=0.0),
        seg(48, 64, 1), seg(64, 80, 2, energy=2.0), seg(80, 88, 4, vocal=0.0)])
    assert names == ["Intro", "Verse 1", "Chorus", "Interlude", "Verse 2", "Chorus", "Outro"]


def test_late_unique_section_is_a_bridge():
    names = label_sections([
        seg(0, 16, 0), seg(16, 32, 1, energy=2.0), seg(32, 48, 0), seg(48, 64, 1, energy=2.0),
        seg(64, 80, 2), seg(80, 96, 1, energy=2.0)])
    assert names == ["Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus"]


def test_no_repetition_falls_back_to_verses():
    names = label_sections([seg(0, 16, 0), seg(16, 32, 1), seg(32, 48, 2)])
    assert all(n.startswith("Verse") for n in names)
