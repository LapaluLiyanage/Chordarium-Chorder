"""Download the SongFormer structure model (about 2.7 GB) into server/engine/weights/SongFormer.

Standalone on purpose (it imports nothing from the app) so the Docker build can run it before the app
code is copied in, which keeps the big download cached when only the code changes.

    python scripts/fetch_songformer.py [target_dir]
"""
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

REPO_ID = "ASLP-lab/SongFormer"
# the model's audio front-end reads this small config from the hub when it is built
FRONTEND_REPO = "facebook/wav2vec2-conformer-rope-large-960h-ft"
DEFAULT_TARGET = Path(__file__).resolve().parents[1] / "server" / "engine" / "weights" / "SongFormer"


def fetch(target: Path = DEFAULT_TARGET) -> Path:
    target = Path(target)
    snapshot_download(repo_id=REPO_ID, local_dir=str(target),
                      # the two 100 MB files duplicate what model.safetensors already holds
                      ignore_patterns=["SongFormer.pt", "SongFormer.safetensors", "*.md", ".gitattributes"])
    hf_hub_download(FRONTEND_REPO, "config.json")
    return target


if __name__ == "__main__":
    print(f"SongFormer ready: {fetch(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_TARGET)}")
