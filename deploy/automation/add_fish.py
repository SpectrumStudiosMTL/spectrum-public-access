#!/usr/bin/env python3
"""
add_fish.py — the script GitHub Actions runs for every automated
(PSD/Krita) fish submission.

It expects these environment variables (set by the workflow from the
monday.com webhook data):

    FISH_FILE_URL   — direct download URL for the submitted .psd
    FISH_CREATOR    — the submitter's name, from the form field
    FISH_NAME       — (optional) the fish's own name, blank if not asked
    FISH_BIO        — (optional) a short bio, blank if not asked
    MONDAY_API_TOKEN — needed because monday.com file URLs require
                       this token in the request header to download

It does five things:
    1. Downloads the submitted file
    2. Extracts the "YOUR FISH DESIGN" layer (same logic proven
       against the Kat test file)
    3. Crops + resizes it and saves it as the next fishN.webp
    4. Inserts a new EMBEDDED_IMAGES entry and FISH array entry into
       feeling-fishy/index.html
    5. Leaves the changed files staged — the workflow handles the
       actual git commit + push

If ANY step looks wrong (layer missing, empty, barely any content),
it exits with a non-zero code and a clear message instead of
guessing — the workflow treats that as "leave this one for manual
review" rather than publishing something broken.
"""

import os
import re
import sys
from pathlib import Path

import requests
from psd_tools import PSDImage
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = REPO_ROOT / "feeling-fishy"
INDEX_HTML = SITE_DIR / "index.html"
FISH_DIR = SITE_DIR / "images" / "fish"
TARGET_LAYER_NAME = "your fish design"
MAX_DIM = 700

# Same cyclic variety used for the original 72 fish, so new ones
# don't all swim at an identical size/height.
HEIGHTS = [28, 48, 20, 58, 38, 18, 32, 46, 60, 25, 40, 54, 22, 36, 50, 64]
SIZES   = [150, 140, 150, 145, 130, 130, 140, 115, 135, 125, 130, 120, 140, 125, 130, 115]


def fail(message, code=1):
    print(f"::error::{message}")
    sys.exit(code)


def download_submission(url, token, dest):
    headers = {"Authorization": token} if token else {}
    resp = requests.get(url, headers=headers, timeout=60)
    if resp.status_code != 200:
        fail(f"Couldn't download the submitted file (HTTP {resp.status_code}).")
    dest.write_bytes(resp.content)


def find_target_layer(psd):
    matches = []

    def walk(layers):
        for layer in layers:
            if layer.name.strip().lower() == TARGET_LAYER_NAME:
                matches.append(layer)
            if layer.is_group():
                walk(layer)

    walk(psd)
    return matches


def extract_artwork(psd_path):
    psd = PSDImage.open(psd_path)
    matches = find_target_layer(psd)
    if not matches:
        fail(f'No layer named "{TARGET_LAYER_NAME}" found. '
             f'Layers present: {[l.name for l in psd]}')

    rendered = matches[0].composite()
    if rendered is None:
        fail("The fish layer has no decodable pixel data.")

    rendered = rendered.convert("RGBA")
    bbox = rendered.getbbox()
    if bbox is None:
        fail("The fish layer is fully transparent — nothing was drawn.")

    cropped = rendered.crop(bbox)
    opaque = sum(1 for p in cropped.getdata() if p[3] > 10)
    total = cropped.width * cropped.height
    if total == 0 or opaque / total < 0.01:
        fail("Almost no visible content on the fish layer — needs a human look.")

    w, h = cropped.size
    scale = MAX_DIM / max(w, h)
    if scale < 1:
        cropped = cropped.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

    return cropped


def next_fish_number():
    content = INDEX_HTML.read_text(encoding="utf-8")
    numbers = [int(n) for n in re.findall(r"EMBEDDED_IMAGES\.fish(\d+)", content)]
    if not numbers:
        fail("Couldn't find any existing fish entries to number from — "
             "index.html may have moved or changed structure.")
    return max(numbers) + 1


def add_embedded_image_entry(content, n):
    marker = "  fish0: \"images/fish/fish0.webp\","
    if marker not in content:
        # fall back: insert right before the closing brace of EMBEDDED_IMAGES
        idx = content.index("const EMBEDDED_IMAGES = {")
        close = content.index("};", idx)
        new_line = f'  fish{n}: "images/fish/fish{n}.webp",\n'
        return content[:close] + new_line + content[close:]
    new_line = f'{marker}\n  fish{n}: "images/fish/fish{n}.webp",'
    return content.replace(marker, new_line, 1)


def add_fish_array_entry(content, n, creator, name, bio):
    h = HEIGHTS[n % len(HEIGHTS)]
    s = SIZES[n % len(SIZES)]
    creator_esc = creator.replace('"', '\\"')
    name_esc = (name or "").replace('"', '\\"')
    bio_esc = (bio or "").replace('"', '\\"')
    new_entry = (
        f'  {{ name: "{name_esc}", creator: "{creator_esc}", bio: "{bio_esc}", '
        f'image: EMBEDDED_IMAGES.fish{n}, sound: EMBEDDED_AUDIO.chime, '
        f'height: {h}, size: {s} }},\n'
    )
    idx = content.index("const FISH = [")
    close = content.index("\n];", idx) + 1  # right before "];"
    return content[:close] + new_entry + content[close:]


def main():
    file_url = os.environ.get("FISH_FILE_URL")
    creator = os.environ.get("FISH_CREATOR")
    name = os.environ.get("FISH_NAME", "")
    bio = os.environ.get("FISH_BIO", "")
    token = os.environ.get("MONDAY_API_TOKEN")

    if not file_url or not creator:
        fail("Missing FISH_FILE_URL or FISH_CREATOR — check the workflow's "
             "client_payload mapping.")

    tmp_path = Path("/tmp/submission.psd")
    download_submission(file_url, token, tmp_path)

    artwork = extract_artwork(tmp_path)

    n = next_fish_number()
    FISH_DIR.mkdir(parents=True, exist_ok=True)
    out_path = FISH_DIR / f"fish{n}.webp"
    artwork.save(out_path, "WEBP", quality=82)

    content = INDEX_HTML.read_text(encoding="utf-8")
    content = add_embedded_image_entry(content, n)
    content = add_fish_array_entry(content, n, creator, name, bio)
    INDEX_HTML.write_text(content, encoding="utf-8")

    print(f"Added fish{n}.webp for {creator} — ready to commit.")


if __name__ == "__main__":
    main()
