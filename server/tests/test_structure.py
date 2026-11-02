from server.engine.structure import is_available, number_kinds, to_sections

BAR = 2.0
DOWNBEATS = [i * BAR for i in range(40)]  # 40 bars, 80 s
DURATION = 80.0


def part(start, end, label):
    return {"start": start, "end": end, "label": label}


def names(sections):
    return [s["label"] for s in sections]


def test_numbers_repeated_kinds_but_not_choruses():
    assert number_kinds(["Intro", "Verse", "Chorus", "Verse", "Chorus", "Bridge", "Chorus", "Outro"]) == [
        "Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Outro"]
    assert number_kinds(["Interlude", "Verse", "Interlude"]) == ["Interlude 1", "Verse", "Interlude 2"]


def test_snaps_the_model_parts_to_bars_and_covers_the_song():
    sections = to_sections([
        part(0.0, 15.7, "intro"), part(15.7, 40.3, "verse"), part(40.3, 62.1, "chorus"), part(62.1, 80.0, "outro")],
        DOWNBEATS, DURATION)
    assert names(sections) == ["Intro", "Verse", "Chorus", "Outro"]
    assert [s["start"] for s in sections] == [0.0, 16.0, 40.0, 62.0]
    assert [s["end"] for s in sections] == [16.0, 40.0, 62.0, 80.0]
    assert not any(s["uncertain"] for s in sections)


def test_inst_is_an_interlude_and_silence_is_dropped():
    sections = to_sections([
        part(0.0, 2.0, "silence"), part(2.0, 20.0, "verse"), part(20.0, 30.0, "inst"), part(30.0, 80.0, "chorus")],
        DOWNBEATS, DURATION)
    assert names(sections) == ["Verse", "Interlude", "Chorus"]
    assert sections[0]["start"] == 0.0 and sections[-1]["end"] == DURATION


def test_neighbours_of_the_same_kind_join_and_blips_are_absorbed():
    sections = to_sections([
        part(0.0, 20.0, "verse"), part(20.0, 40.0, "verse"), part(40.0, 41.0, "bridge"),
        part(41.0, 70.0, "chorus"), part(70.0, 80.0, "outro")], DOWNBEATS, DURATION)
    assert names(sections) == ["Verse", "Chorus", "Outro"]
    assert sections[0]["end"] == 40.0 or sections[0]["end"] == 42.0


def test_repeated_verses_are_numbered():
    sections = to_sections([
        part(0.0, 16.0, "verse"), part(16.0, 32.0, "chorus"), part(32.0, 48.0, "verse"), part(48.0, 80.0, "chorus")],
        DOWNBEATS, DURATION)
    assert names(sections) == ["Verse 1", "Chorus", "Verse 2", "Chorus"]


def test_nothing_usable_gives_no_sections():
    assert to_sections([], DOWNBEATS, DURATION) == []
    assert to_sections([part(0.0, 80.0, "silence")], DOWNBEATS, DURATION) == []
    assert to_sections([part(0.0, 80.0, "verse")], [0.0], DURATION) == []


def test_is_available_needs_the_weights_file(tmp_path):
    assert not is_available(tmp_path)
    (tmp_path / "SongFormer").mkdir()
    (tmp_path / "SongFormer" / "model.safetensors").write_bytes(b"x")
    assert is_available(tmp_path)
