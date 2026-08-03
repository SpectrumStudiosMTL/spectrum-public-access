#!/usr/bin/env python3
"""
fish_pipeline.py -- shared logic for turning a clean, transparent
fish image into a published FISH entry.

Used by both add_fish.py (the automated webhook path, for formats an
extraction can trust completely) and add_fish_manual.py (the
human-driven path for everything else: scans, photos, .kra exports,
or anything the automated path rejected). Both converge here once
they've reduced a submission to a single clean RGBA image -- this
module doesn't know or care where that image came from.
"""

import hashlib
import re
import sys
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = REPO_ROOT / "feeling-fishy"
INDEX_HTML = SITE_DIR / "index.html"
FISH_DIR = SITE_DIR / "images" / "fish"
MAX_DIM = 700

# Same cyclic variety used for the original 72 fish, so new ones
# don't all swim at an identical size/height.
HEIGHTS = [28, 48, 20, 58, 38, 18, 32, 46, 60, 25, 40, 54, 22, 36, 50, 64]
SIZES   = [150, 140, 150, 145, 130, 130, 140, 115, 135, 125, 130, 120, 140, 125, 130, 115]


def fail(message, code=1):
    print(f"::error::{message}")
    sys.exit(code)


# Groups a person's fish together (see creatorKey() in index.html)
# without ever publishing their actual email address. Truncated to
# 12 hex chars -- plenty to avoid collisions for a project this size
# while keeping the FISH array entries short.
def creator_id_from_email(email):
    normalized = email.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]


# True only if the image has an alpha channel AND some of it is
# actually non-opaque -- some tools write an RGBA PNG with every
# pixel at alpha=255 out of habit, which functionally means "no
# transparency" even though the mode says otherwise.
def has_real_transparency(image):
    if image.mode not in ("RGBA", "LA"):
        return False
    alpha = image.convert("RGBA").split()[-1]
    return alpha.getextrema()[0] < 250


# Shared tail end for every submission format once it's been reduced
# to a single clean RGBA image: crop to the real content and cap the
# longest side at MAX_DIM.
def normalize_artwork(image):
    rendered = image.convert("RGBA")
    bbox = rendered.getbbox()
    if bbox is None:
        fail("The artwork is fully transparent -- nothing was drawn.")

    cropped = rendered.crop(bbox)
    opaque = sum(1 for p in cropped.getdata() if p[3] > 10)
    total = cropped.width * cropped.height
    if total == 0 or opaque / total < 0.01:
        fail("Almost no visible content in the artwork -- needs a human look.")

    w, h = cropped.size
    scale = MAX_DIM / max(w, h)
    if scale < 1:
        cropped = cropped.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return cropped


def next_fish_number():
    content = INDEX_HTML.read_text(encoding="utf-8")
    numbers = [int(n) for n in re.findall(r"EMBEDDED_IMAGES\.fish(\d+)", content)]
    if not numbers:
        fail("Couldn't find any existing fish entries to number from -- "
             "index.html may have moved or changed structure.")

    # Also check for files already sitting in images/fish/ that aren't
    # referenced in index.html anymore (an old submission whose entry
    # got removed but whose file didn't, for example). Numbering off
    # of index.html alone can hand out an already-taken filename and
    # silently overwrite it -- this happened for real with an orphaned
    # fish72.webp from an old "Kat" test submission.
    if FISH_DIR.exists():
        existing_files = [
            int(m.group(1))
            for f in FISH_DIR.glob("fish*.webp")
            if (m := re.match(r"fish(\d+)\.webp$", f.name))
        ]
        numbers += existing_files

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


def add_fish_array_entry(content, n, creator, creator_id, name, bio):
    h = HEIGHTS[n % len(HEIGHTS)]
    s = SIZES[n % len(SIZES)]
    creator_esc = creator.replace('"', '\\"')
    name_esc = (name or "").replace('"', '\\"')
    bio_esc = (bio or "").replace('"', '\\"')
    new_entry = (
        f'  {{ name: "{name_esc}", creator: "{creator_esc}", creatorId: "{creator_id}", bio: "{bio_esc}", '
        f'image: EMBEDDED_IMAGES.fish{n}, sound: EMBEDDED_AUDIO.chime, '
        f'height: {h}, size: {s} }},\n'
    )
    idx = content.index("const FISH = [")
    close = content.index("\n];", idx) + 1  # right before "];"
    return content[:close] + new_entry + content[close:]


# The one thing every format converges on: save the webp, insert the
# FISH entry, write index.html back out. Returns the fish number used.
def write_fish(image, creator, creator_email, name, bio):
    n = next_fish_number()
    FISH_DIR.mkdir(parents=True, exist_ok=True)
    out_path = FISH_DIR / f"fish{n}.webp"
    image.save(out_path, "WEBP", quality=82)

    creator_id = creator_id_from_email(creator_email)
    content = INDEX_HTML.read_text(encoding="utf-8")
    content = add_embedded_image_entry(content, n)
    content = add_fish_array_entry(content, n, creator, creator_id, name, bio)
    INDEX_HTML.write_text(content, encoding="utf-8")
    return n
