#!/usr/bin/env python3
"""
add_fish_manual.py -- the human-driven counterpart to add_fish.py.

Use this for any submission the automated pipeline can't safely
handle on its own:
    - a scanned or photographed drawing (cut out the background
      yourself, in whatever tool you're comfortable with)
    - a .kra file (open it in Krita, hide every layer except
      "YOUR FISH DESIGN", export just that layer as a transparent PNG)
    - anything add_fish.py rejected for looking uncertain

Save the result as a PNG with a real alpha channel, then run this on
it. It shares the exact same crop/resize/publish logic as
add_fish.py -- the only difference is where the clean image comes
from. Like the automated path, this never touches main directly: it
pushes a branch and prints a link to open a PR, so review works the
same way no matter which door a submission came through.

Usage:
    python add_fish_manual.py --file cleaned.png \\
        --creator "Jamie" --email jamie@example.com \\
        [--name "Bubbles"] [--bio "My first fish!"]
"""

import argparse
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fish_pipeline import REPO_ROOT, fail, has_real_transparency, normalize_artwork, write_fish


def load_clean_image(path):
    image = Image.open(path)
    # Phone photos (and some editors) carry an EXIF orientation tag
    # that disagrees with the raw pixel data -- normalize it up front
    # rather than trusting whatever the source app wrote. This isn't
    # theoretical: a real test photo came out rotated 90 degrees
    # until this was applied.
    image = ImageOps.exif_transpose(image)
    if not has_real_transparency(image):
        fail(f"{path} doesn't have real transparency -- this script expects "
             f"the background to already be cut out. Re-export it with a "
             f"transparent background and try again.")
    return image.convert("RGBA")


def run(cmd):
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True, cwd=REPO_ROOT)


def ensure_clean_starting_point():
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        check=True, cwd=REPO_ROOT, capture_output=True, text=True,
    ).stdout
    if status.strip():
        fail("Working tree isn't clean -- commit or stash your changes first "
             "so they don't get bundled into the submission PR.")
    run(["git", "checkout", "main"])
    run(["git", "pull"])


def open_review_pr(n, creator):
    remote = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        check=True, cwd=REPO_ROOT, capture_output=True, text=True,
    ).stdout.strip()
    slug = remote.split("github.com")[-1].lstrip(":/")
    if slug.endswith(".git"):
        slug = slug[:-4]

    branch = f"fish-submission/manual-fish{n}"
    run(["git", "checkout", "-b", branch])
    run(["git", "add",
         "deploy/feeling-fishy/index.html",
         "deploy/feeling-fishy/images/fish/"])
    run(["git", "commit", "-m", f"Add fish from {creator} (manual)"])
    run(["git", "push", "-u", "origin", branch])

    print()
    print("Pushed. Open a PR to review and publish it:")
    print(f"  https://github.com/{slug}/compare/main...{branch}?expand=1")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", required=True, help="Path to the cleaned, transparent PNG")
    parser.add_argument("--creator", required=True)
    parser.add_argument("--email", required=True, help="Never published -- only a hash of it is")
    parser.add_argument("--name", default="")
    parser.add_argument("--bio", default="")
    args = parser.parse_args()

    ensure_clean_starting_point()

    image = load_clean_image(args.file)
    normalized = normalize_artwork(image)
    n = write_fish(normalized, args.creator, args.email, args.name, args.bio)
    print(f"Added fish{n}.webp for {args.creator}.")

    open_review_pr(n, args.creator)


if __name__ == "__main__":
    main()
