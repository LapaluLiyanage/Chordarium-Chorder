import copy

import pytest

from server.app import create_app
from server.store import Store

VID = "dQw4w9WgXcQ"


class FakeRunner:
    def __init__(self, store):
        self.store, self.submitted = store, []

    def submit(self, video_id, mode):
        self.submitted.append((video_id, mode))
        return self.store.create_job(video_id, mode)

    def cancel(self, job_id):
        return self.store.get_job(job_id) is not None


@pytest.fixture
def ctx(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    runner = FakeRunner(store)
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True}, store=store, runner=runner)
    return app.test_client(), store, runner


def test_analyze_validates_input(ctx):
    client, _, runner = ctx
    assert client.post("/api/analyze", json={"url": "https://vimeo.com/1"}).status_code == 400
    assert client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}", "mode": "turbo"}).status_code == 400
    assert client.post("/api/analyze", json={}).status_code == 400
    assert runner.submitted == []


def test_analyze_starts_job_then_polls(ctx):
    client, store, runner = ctx
    r = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}?si=x", "mode": "accurate"})
    assert r.status_code == 202
    job_id = r.get_json()["job_id"]
    assert runner.submitted == [(VID, "accurate")]
    assert client.get(f"/api/jobs/{job_id}").get_json()["state"] == "queued"
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/cancel").get_json() == {"cancelled": True}
    assert client.post("/api/jobs/nope/cancel").status_code == 404


def test_analyze_twice_reuses_running_job(ctx):
    client, _, runner = ctx
    first = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}"}).get_json()["job_id"]
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 202 and r.get_json() == {"job_id": first}
    assert len(runner.submitted) == 1


def test_analyze_returns_cached_song(ctx, timeline):
    client, store, runner = ctx
    timeline["video_id"] = VID
    song_id = store.save_song(timeline)
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 200 and r.get_json() == {"song_id": song_id, "cached": True}
    assert runner.submitted == []


def test_song_crud(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.get("/api/songs").get_json()[0]["id"] == song_id
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["key"] == "G:min"
    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_edit_and_reset_routes_are_gone(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.put(f"/api/songs/{song_id}/segments/0", json={"label": "C:min"}).status_code == 404
    assert client.post(f"/api/songs/{song_id}/reset").status_code == 404
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["segments"][0]["label"] == "C:min7"


@pytest.mark.parametrize("fmt,mimetype,ext", [
    ("chordpro", "text/plain", "cho"), ("txt", "text/plain", "txt"), ("json", "application/json", "json"),
    ("pdf", "application/pdf", "pdf"), ("midi", "audio/midi", "mid"),
])
def test_exports(ctx, timeline, fmt, mimetype, ext):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    r = client.post(f"/api/songs/{song_id}/export?fmt={fmt}&transpose=1&capo=2&simplify=1&bars_per_row=8",
                    json={"timeline": timeline})
    assert r.status_code == 200
    assert r.mimetype == mimetype
    assert r.headers["Content-Disposition"] == f'attachment; filename="Test-Song.{ext}"'


def test_export_uses_the_posted_timeline_not_the_stored_one(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    edited = copy.deepcopy(timeline)
    edited["segments"][0]["label"] = "G:maj"
    r = client.post(f"/api/songs/{song_id}/export?fmt=json", json={"timeline": edited})
    assert r.get_json()["segments"][0]["label"] == "G:maj"
    assert store.get_song(song_id)["timeline"]["segments"][0]["label"] == "C:min7"


def test_export_requires_a_timeline_body(ctx, timeline):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json={}).status_code == 400
    assert client.post(f"/api/songs/{song_id}/export?fmt=json").status_code == 400


@pytest.mark.parametrize("query", ["fmt=docx", "fmt=pdf&transpose=9", "fmt=pdf&capo=-1",
                                   "fmt=pdf&bars_per_row=5", "fmt=pdf&transpose=abc"])
def test_export_rejects_bad_params(ctx, timeline, query):
    client, store, _ = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?{query}", json={"timeline": timeline}).status_code == 400
