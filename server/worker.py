"""Standalone worker: polls the jobs table and runs the analysis pipeline.

Runs as its own process/service, separate from the Flask API, so a slow
analysis never blocks request handling. Talks to the API only through the
shared database — never imports server.app.
"""
import logging
import os
import shutil
import time
from pathlib import Path

from server.engine import pipeline
from server.engine.ingest import IngestError
from server.store import Store

log = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 2.0


def run_once(store: Store, work_root: Path, analyze_fn=pipeline.analyze, keep_audio: bool = False) -> bool:
    """Claim and fully process one queued job, if any. Returns whether one was found."""
    job = store.claim_next_job()
    if job is None:
        return False
    job_id, video_id, mode = job["id"], job["video_id"], job["mode"]
    work_dir = Path(work_root) / video_id

    def progress(state: str, percent: int, message: str) -> None:
        if store.get_job(job_id)["cancel_requested"]:
            raise pipeline.Cancelled()
        store.update_job(job_id, state=state, progress=percent, message=message)

    try:
        timeline = analyze_fn(video_id, work_dir, pipeline.Options(mode=mode), progress)
        song_id = store.save_song(timeline)
        store.update_job(job_id, state="done", progress=100, message="Done", song_id=song_id)
    except pipeline.Cancelled:
        store.update_job(job_id, state="cancelled", message="Cancelled")
    except IngestError as e:
        store.update_job(job_id, state="failed", error=str(e), message="Failed")
    except Exception as e:
        log.exception("Job %s failed", job_id)
        store.update_job(job_id, state="failed", error=f"Analysis failed: {e}", message="Failed")
    finally:
        if not keep_audio:
            shutil.rmtree(work_dir, ignore_errors=True)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    store = Store(os.environ["DATABASE_URL"])
    work_root = Path(os.environ.get("CHORDARIUM_DATA", Path(__file__).parent / "data")) / "audio"
    reset = store.fail_interrupted_jobs()
    if reset:
        log.info("Marked %d job(s) failed after worker restart", reset)
    log.info("Worker started, polling every %ss", POLL_INTERVAL_SECONDS)
    while True:
        if not run_once(store, work_root):
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
