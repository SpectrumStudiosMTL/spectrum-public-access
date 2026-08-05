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
import json
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


# Only the first name gets published on the site -- avoids putting a
# submitter's full legal name on a public page. The full name is
# still what monday.com reports on, and still shows up in the PR
# title/commit message the workflow and the manual script build
# straight from the form payload, entirely independent of this.
def first_name_only(full_name):
    parts = (full_name or "").strip().split()
    return parts[0] if parts else full_name


# True only if the image has an alpha channel AND some of it is
# actually non-opaque -- some tools write an RGBA PNG with every
# pixel at alpha=255 out of habit, which functionally means "no
# transparency" even though the mode says otherwise. Converting to
# RGBA unconditionally (rather than gating on mode first) is what
# makes this correct for palette ("P") images too -- a PNG can carry
# real transparency through its palette's own transparency entry
# without ever being in RGBA/LA mode, and PIL's own convert() already
# knows how to derive real alpha from that. A source image with no
# transparency at all (plain RGB, or P with no transparency entry)
# still converts cleanly to fully-opaque RGBA, so this stays correct
# for that case too.
def has_real_transparency(image):
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
        if "const EMBEDDED_IMAGES = {" not in content:
            fail("Couldn't find 'const EMBEDDED_IMAGES = {' in index.html -- "
                 "it may have moved or changed structure.")
        idx = content.index("const EMBEDDED_IMAGES = {")
        if "};" not in content[idx:]:
            fail("Couldn't find the closing '};' for EMBEDDED_IMAGES in "
                 "index.html -- it may have moved or changed structure.")
        close = content.index("};", idx)
        new_line = f'  fish{n}: "images/fish/fish{n}.webp",\n'
        return content[:close] + new_line + content[close:]
    new_line = f'{marker}\n  fish{n}: "images/fish/fish{n}.webp",'
    return content.replace(marker, new_line, 1)


# Safely encodes a string as a JS string literal (including the
# surrounding quotes) for embedding in the inline <script> block these
# entries live in. These fields come straight from public form
# submissions with no validation, so this has to hold up against
# deliberately hostile input, not just accidental typos:
#
# - json.dumps() produces valid JS string syntax (JSON string escaping
#   is a compatible subset of JS's) and correctly handles backslashes,
#   quotes, and control characters/newlines -- the previous
#   `.replace('"', '\\"')` only escaped quotes, so a value ending in an
#   odd number of backslashes desynced the string boundary and could
#   swallow the rest of the entry, and a literal newline (e.g. a
#   multi-line bio) was a straight SyntaxError that broke the whole
#   shared <script> block for every visitor.
# - json.dumps() does NOT escape "/", so a value containing the literal
#   text "</script" would still terminate the surrounding <script> tag
#   at the HTML-parser level regardless of JS string quoting -- that's
#   real stored XSS, independent of the escaping above. Replacing "</"
#   with "<\/" (a no-op once JS decodes the string, since "\/" is just
#   "/") neutralizes that without changing the published value.
def js_string_literal(value):
    return json.dumps(value).replace("</", "<\\/")


def add_fish_array_entry(content, n, creator, creator_id, name, bio):
    h = HEIGHTS[n % len(HEIGHTS)]
    s = SIZES[n % len(SIZES)]
    new_entry = (
        f'  {{ name: {js_string_literal(name or "")}, creator: {js_string_literal(creator)}, '
        f'creatorId: {js_string_literal(creator_id)}, bio: {js_string_literal(bio or "")}, '
        f'image: EMBEDDED_IMAGES.fish{n}, sound: EMBEDDED_AUDIO.chime, '
        f'height: {h}, size: {s} }},\n'
    )
    if "const FISH = [" not in content:
        fail("Couldn't find 'const FISH = [' in index.html -- it may have "
             "moved or changed structure.")
    idx = content.index("const FISH = [")
    if "\n];" not in content[idx:]:
        fail("Couldn't find the closing '];' for the FISH array in "
             "index.html -- it may have moved or changed structure.")
    close = content.index("\n];", idx) + 1  # right before "];"
    return content[:close] + new_entry + content[close:]


# The one thing every format converges on: save the webp, insert the
# FISH entry, write index.html back out. Returns the fish number used.
def write_fish(image, creator, creator_email, name, bio):
    n = next_fish_number()

    # Build the new index.html content entirely in memory first, before
    # writing anything to disk -- add_embedded_image_entry/
    # add_fish_array_entry each fail() cleanly if index.html's expected
    # structure is missing, and doing that check before saving the webp
    # means a structural failure can't leave an orphaned fishN.webp
    # with no corresponding entry (it used to be saved first).
    creator_id = creator_id_from_email(creator_email)
    published_creator = first_name_only(creator)
    content = INDEX_HTML.read_text(encoding="utf-8")
    content = add_embedded_image_entry(content, n)
    content = add_fish_array_entry(content, n, published_creator, creator_id, name, bio)

    FISH_DIR.mkdir(parents=True, exist_ok=True)
    out_path = FISH_DIR / f"fish{n}.webp"
    image.save(out_path, "WEBP", quality=82)
    INDEX_HTML.write_text(content, encoding="utf-8")
    return n
