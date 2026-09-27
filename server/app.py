"""Chordarium HTTP API."""
import logging
import os
import re

from flask import Flask, Response, jsonify, request

from server.engine.ingest import parse_video_id
from server.export.chordpro import to_chordpro
from server.export.grid import ExportOptions
from server.export.json_export import to_json
from server.export.midi import to_midi
from server.export.pdf import to_pdf
from server.export.txt import to_txt
from server.store import Store

EXPORTERS = {
    "chordpro": (to_chordpro, "text/plain", "cho"),
    "txt": (to_txt, "text/plain", "txt"),
    "json": (to_json, "application/json", "json"),
    "pdf": (to_pdf, "application/pdf", "pdf"),
    "midi": (to_midi, "audio/midi", "mid"),
}
MODES = ("fast", "accurate")


class BadRequest(Exception):
    pass


def _int_arg(name: str, default: int, lo: int, hi: int, allowed: tuple[int, ...] | None = None) -> int:
    raw = request.args.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise BadRequest(f"{name} must be a whole number")
    if not lo <= value <= hi or (allowed and value not in allowed):
        raise BadRequest(f"{name} is out of range")
    return value


def _slug(title: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", title).strip("-") or "chordarium"


def create_app(config: dict | None = None, store: Store | None = None) -> Flask:
    app = Flask(__name__)
    if config:
        app.config.update(config)
    store = store or Store(os.environ["DATABASE_URL"])

    def error(message: str, status: int):
        return jsonify({"error": message}), status

    @app.errorhandler(BadRequest)
    def _bad_request(e):
        return error(str(e), 400)

    @app.post("/api/analyze")
    def analyze():
        body = request.get_json(silent=True) or {}
        mode = body.get("mode", "fast")
        if mode not in MODES:
            raise BadRequest("mode must be 'fast' or 'accurate'")
        video_id = parse_video_id(str(body.get("url", "")))
        if not video_id:
            raise BadRequest("That doesn't look like a YouTube video link.")
        cached = store.get_song_by_video(video_id)
        if cached:
            return jsonify({"song_id": cached["id"], "cached": True})
        active = store.get_active_job(video_id)
        if active:
            return jsonify({"job_id": active["id"]}), 202
        return jsonify({"job_id": store.create_job(video_id, mode)}), 202

    @app.get("/api/jobs/<job_id>")
    def get_job(job_id):
        job = store.get_job(job_id)
        return jsonify(job) if job else error("Job not found", 404)

    @app.post("/api/jobs/<job_id>/cancel")
    def cancel_job(job_id):
        return jsonify({"cancelled": store.request_cancel(job_id)}) if store.get_job(job_id) else error("Job not found", 404)

    @app.get("/api/songs")
    def list_songs():
        return jsonify(store.list_songs())

    @app.get("/api/songs/<song_id>")
    def get_song(song_id):
        song = store.get_song(song_id)
        return jsonify(song) if song else error("Song not found", 404)

    @app.delete("/api/songs/<song_id>")
    def delete_song(song_id):
        return ("", 204) if store.delete_song(song_id) else error("Song not found", 404)

    @app.post("/api/songs/<song_id>/export")
    def export_song(song_id):
        song = store.get_song(song_id)
        if song is None:
            return error("Song not found", 404)
        body = request.get_json(silent=True)
        body = body if isinstance(body, dict) else {}
        timeline = body.get("timeline")
        if not isinstance(timeline, dict) or not isinstance(timeline.get("segments"), list):
            raise BadRequest("Request body must include a 'timeline' object with a segments list.")
        fmt = request.args.get("fmt", "pdf")
        if fmt not in EXPORTERS:
            raise BadRequest(f"fmt must be one of {', '.join(EXPORTERS)}")
        opts = ExportOptions(
            transpose=_int_arg("transpose", 0, -6, 6),
            capo=_int_arg("capo", 0, 0, 7),
            simplify=request.args.get("simplify") in ("1", "true"),
            bars_per_row=_int_arg("bars_per_row", 4, 4, 8, allowed=(4, 8)),
        )
        render, mimetype, ext = EXPORTERS[fmt]
        try:
            data = render(timeline, opts)
        except (KeyError, TypeError, ValueError, IndexError, AttributeError) as e:
            raise BadRequest(f"Invalid timeline: {e}")
        if isinstance(data, str):
            data = data.encode("utf-8")
        filename = f"{_slug(song['title'])}.{ext}"
        return Response(data, mimetype=mimetype,
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    create_app().run(host="127.0.0.1", port=5000, debug=False)
