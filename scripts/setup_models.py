"""Fetch the models into server/engine/weights/.

Always: BTC-ISMIR19 (chord recognition, code + pretrained weights).
With --songformer: SongFormer (song structure for Accurate mode, about 2.7 GB).
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.engine import structure  # noqa: E402
from server.engine.chords_btc import DEFAULT_WEIGHTS_DIR, REPO_DIRNAME, is_available  # noqa: E402

REPO_URL = "https://github.com/jayg996/BTC-ISMIR19.git"


def setup_btc() -> int:
    DEFAULT_WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    repo = DEFAULT_WEIGHTS_DIR / REPO_DIRNAME
    if not repo.exists():
        subprocess.run(["git", "clone", "--depth", "1", REPO_URL, str(repo)], check=True)
    if is_available(DEFAULT_WEIGHTS_DIR):
        print(f"BTC model ready: {repo}")
        return 0
    print(f"Cloned {repo} but the large-vocab weights file is missing.", file=sys.stderr)
    return 1


def setup_songformer() -> int:
    if not structure.is_available(DEFAULT_WEIGHTS_DIR):
        target = structure.download(DEFAULT_WEIGHTS_DIR)
    else:
        target = DEFAULT_WEIGHTS_DIR / structure.DIRNAME
    if structure.is_available(DEFAULT_WEIGHTS_DIR):
        print(f"SongFormer ready: {target}")
        return 0
    print(f"Downloaded SongFormer to {target} but {structure.WEIGHTS_FILE} is missing.", file=sys.stderr)
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--songformer", action="store_true", help="also fetch the SongFormer structure model (~2.7 GB)")
    args = parser.parse_args()
    status = setup_btc()
    if args.songformer:
        status = max(status, setup_songformer())
    return status


if __name__ == "__main__":
    sys.exit(main())
