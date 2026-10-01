import copy
import subprocess
import sys

import pytest

from server.app import create_app

VID = "dQw4w9WgXcQ"


@pytest.fixture
def ctx(store, tmp_path):
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True}, store=store)
    return app.test_client(), store


def test_analyze_validates_input(ctx):
    client, store = ctx
    assert client.post("/api/analyze", json={"url": "https://vimeo.com/1"}).status_code == 400
    assert client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}", "mode": "turbo"}).status_code == 400
    assert client.post("/api/analyze", json={}).status_code == 400
    assert store.list_songs() == []


def test_analyze_starts_job_then_polls(ctx):
    client, store = ctx
    r = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}?si=x", "mode": "accurate"})
    assert r.status_code == 202
    job_id = r.get_json()["job_id"]
    job = store.get_job(job_id)
    assert (job["video_id"], job["mode"], job["state"]) == (VID, "accurate", "queued")
    assert client.get(f"/api/jobs/{job_id}").get_json()["state"] == "queued"
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.post(f"/api/jobs/{job_id}/cancel").get_json() == {"cancelled": True}
    assert store.get_job(job_id)["state"] == "cancelled"
    assert client.post("/api/jobs/nope/cancel").status_code == 404


def test_analyze_twice_reuses_running_job(ctx):
    client, store = ctx
    first = client.post("/api/analyze", json={"url": f"https://youtu.be/{VID}"}).get_json()["job_id"]
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 202 and r.get_json() == {"job_id": first}
    assert store.get_active_job(VID)["id"] == first


def test_analyze_returns_cached_song(ctx, timeline):
    client, store = ctx
    timeline["video_id"] = VID
    song_id = store.save_song(timeline)
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}"})
    assert r.status_code == 200 and r.get_json() == {"song_id": song_id, "cached": True}
    assert store.get_active_job(VID) is None


def test_analyze_refresh_reanalyzes_a_cached_song(ctx, timeline):
    client, store = ctx
    timeline["video_id"] = VID
    store.save_song(timeline)
    r = client.post("/api/analyze", json={"url": f"https://www.youtube.com/watch?v={VID}", "refresh": True})
    assert r.status_code == 202 and store.get_active_job(VID)["id"] == r.get_json()["job_id"]


def test_song_crud(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.get("/api/songs").get_json()[0]["id"] == song_id
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["key"] == "G:min"
    assert client.delete(f"/api/songs/{song_id}").status_code == 204
    assert client.get(f"/api/songs/{song_id}").status_code == 404


def test_edit_and_reset_routes_are_gone(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.put(f"/api/songs/{song_id}/segments/0", json={"label": "C:min"}).status_code == 404
    assert client.post(f"/api/songs/{song_id}/reset").status_code == 404
    assert client.get(f"/api/songs/{song_id}").get_json()["timeline"]["segments"][0]["label"] == "C:min7"


@pytest.mark.parametrize("fmt,mimetype,ext", [
    ("chordpro", "text/plain", "cho"), ("txt", "text/plain", "txt"), ("json", "application/json", "json"),
    ("pdf", "application/pdf", "pdf"), ("midi", "audio/midi", "mid"),
])
def test_exports(ctx, timeline, fmt, mimetype, ext):
    client, store = ctx
    song_id = store.save_song(timeline)
    r = client.post(f"/api/songs/{song_id}/export?fmt={fmt}&transpose=1&capo=2&simplify=1&bars_per_row=8",
                    json={"timeline": timeline})
    assert r.status_code == 200
    assert r.mimetype == mimetype
    assert r.headers["Content-Disposition"] == f'attachment; filename="Test-Song.{ext}"'


def test_export_uses_the_posted_timeline_not_the_stored_one(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    edited = copy.deepcopy(timeline)
    edited["segments"][0]["label"] = "G:maj"
    r = client.post(f"/api/songs/{song_id}/export?fmt=json", json={"timeline": edited})
    assert r.get_json()["segments"][0]["label"] == "G:maj"
    assert store.get_song(song_id)["timeline"]["segments"][0]["label"] == "C:min7"


def test_export_requires_a_timeline_body(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json={}).status_code == 400
    assert client.post(f"/api/songs/{song_id}/export?fmt=json").status_code == 400


@pytest.mark.parametrize("bad_timeline", [
    {"segments": []},
    {"segments": "x"},
    "not-a-dict",
])
def test_export_rejects_incomplete_timeline_with_400(ctx, timeline, bad_timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad_timeline}).status_code == 400


def test_export_rejects_a_bad_chord_label_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    bad = copy.deepcopy(timeline)
    bad["segments"][0]["label"] = "H:maj"
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad}).status_code == 400


def test_export_rejects_a_segment_missing_start_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    bad = copy.deepcopy(timeline)
    del bad["segments"][0]["start"]
    assert client.post(f"/api/songs/{song_id}/export?fmt=pdf", json={"timeline": bad}).status_code == 400


def test_export_rejects_a_non_object_body_with_400(ctx, timeline):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?fmt=json", json=[1, 2]).status_code == 400


@pytest.mark.parametrize("query", ["fmt=docx", "fmt=pdf&transpose=9", "fmt=pdf&capo=-1",
                                   "fmt=pdf&bars_per_row=5", "fmt=pdf&transpose=abc"])
def test_export_rejects_bad_params(ctx, timeline, query):
    client, store = ctx
    song_id = store.save_song(timeline)
    assert client.post(f"/api/songs/{song_id}/export?{query}", json={"timeline": timeline}).status_code == 400


def test_app_module_does_not_import_the_pipeline():
    """A fresh process importing only server.app must never pull in the
    pipeline (librosa/torch/Demucs) - that heavy-CPU import chain is exactly
    what this split keeps off the request-handling process. Run in a
    subprocess: sys.modules is shared across this whole pytest session, and
    test_worker.py/test_pipeline.py legitimately import the pipeline
    elsewhere in it, so checking sys.modules in-process would pass or fail
    based on test order, not on server.app's own import graph.
    """
    result = subprocess.run(
        [sys.executable, "-c", "import server.app, sys; assert 'server.engine.pipeline' not in sys.modules"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr


def test_create_app_never_marks_jobs_failed_on_startup(store, tmp_path):
    """Restarting the web service must not touch jobs a separate worker still owns.

    The old JobRunner-based app called store.fail_interrupted_jobs() when it
    started, because restarting that process really did orphan any job it
    was running in-thread. That's no longer true once the worker is a
    separate process - creating (or re-creating) the Flask app must leave
    an in-progress job alone.
    """
    job_id = store.create_job("abcdefghijk", "fast")
    store.update_job(job_id, state="beats")
    create_app({"DATA_DIR": tmp_path, "TESTING": True}, store=store)
    assert store.get_job(job_id)["state"] == "beats"
