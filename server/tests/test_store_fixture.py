def test_store_fixture_round_trips(store, timeline):
    song_id = store.save_song(timeline)
    assert store.get_song(song_id)["title"] == "Test Song"
