#!/usr/bin/env python3
"""
add_fish.py -- the script GitHub Actions runs for every automated
fish submission (fired by the monday.com webhook).

It expects these environment variables (set by the workflow from the
webhook data):

    FISH_FILE_URL      -- direct download URL for the submitted file
    FISH_CREATOR       -- the submitter's name, from the form field
    FISH_CREATOR_EMAIL -- the submitter's email, from the form field.
                        Never written to index.html or any published
                        file -- only a short one-way hash of it is, as
                        creatorId, so fish can be grouped by the real
                        person who made them (two different people
                        can share a display name) without publishing
                        their address. The email itself belongs to
                        monday.com's own submissions record, which is
                        the system of record for grant reporting.
    FISH_NAME          -- (optional) the fish's own name, blank if not asked
    FISH_BIO           -- (optional) a short bio, blank if not asked

Only submissions where the artwork can be isolated with certainty are
handled automatically:
    .psd                 -- the "your fish design" layer, composited
    .png with real alpha -- used as-is, already isolated by whoever made it

Everything else fails on purpose: a flat scan/photo, a .kra (Krita
stores each layer's actual pixel data in its own undocumented tiled
binary format -- there's no library for it the way psd-tools covers
PSD, and this template's guide layers are visible at partial opacity,
so even Krita's own flattened preview isn't clean), or a PNG/JPEG
with no real transparency. That's the intended outcome, not a bug --
it's the signal that a human needs to run add_fish_manual.py on this
one instead of letting automation guess at an extraction it can't be
sure of.

It does four things:
    1. Downloads the submitted file
    2. Works out which of the two automatable cases it is and isolates
       the artwork
    3. Crops + resizes it and saves it as the next fishN.webp
    4. Inserts a new EMBEDDED_IMAGES entry and FISH array entry into
       feeling-fishy/index.html

Leaves the changed files staged -- the workflow opens a PR with them
instead of publishing straight away, so a human confirms the
extracted artwork looks right before it goes live.

If ANY step looks wrong, it exits with a non-zero code and a clear
message instead of guessing -- the workflow treats that as "leave
this one for manual review" rather than publishing something broken.
"""

import os
import sys
from pathlib import Path

import requests
from psd_tools import PSDImage
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fish_pipeline import fail, has_real_transparency, normalize_artwork, write_fish

TARGET_LAYER_NAME = "your fish design"


def download_submission(url):
    # monday's asset public_url is a pre-signed link -- it's already
    # authenticated via the URL itself. Adding an Authorization header
    # on top of that can break the signature and cause an HTTP 400,
    # so this deliberately does NOT send one.
    try:
        resp = requests.get(url, timeout=60)
    except requests.RequestException as e:
        fail(f"Couldn't reach {url}: {e}")
    if resp.status_code != 200:
        fail(f"Couldn't download the submitted file (HTTP {resp.status_code}). "
             f"Response body: {resp.text[:500]}")
    return resp.content


# Some hosts (GitHub's own attachment URLs, used for manual testing via
# workflow_dispatch, are a real example) don't put a file extension in
# the URL at all -- https://github.com/user-attachments/assets/<uuid>.
# Trusting the URL's suffix alone silently misclassifies those as
# "unrecognized" even when the actual content is a perfectly good PNG.
# Sniffing the real file signature is what monday's URLs (which do
# carry a real extension) would also match, so this replaces the
# suffix check rather than just patching around it.
def sniff_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"8BPS"):
        return ".psd"
    if data.startswith(b"PK\x03\x04"):
        return ".kra"
    return None


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


def extract_from_psd(path):
    try:
        psd = PSDImage.open(path)
    except Exception as e:
        fail(f"Couldn't open the PSD file -- it may be corrupt: {e}")
    matches = find_target_layer(psd)
    if not matches:
        fail(f'No layer named "{TARGET_LAYER_NAME}" found. '
             f'Layers present: {[l.name for l in psd]}')

    rendered = matches[0].composite()
    if rendered is None:
        fail("The fish layer has no decodable pixel data.")
    return rendered.convert("RGBA")


def extract_from_flat_image(path, suffix):
    if suffix in (".jpg", ".jpeg"):
        fail("JPEGs can't carry transparency, so there's no reliable way to "
             "separate the fish from its background automatically. Cut it "
             "out by hand and run it through add_fish_manual.py instead.")

    try:
        with Image.open(path) as image:
            if not has_real_transparency(image):
                fail("This PNG has no real transparency -- it looks like a "
                     "flat scan or photo, not pre-isolated artwork. Cut out "
                     "the background by hand and run it through "
                     "add_fish_manual.py instead.")
            return image.convert("RGBA")
    except OSError as e:
        fail(f"Couldn't open the image file -- it may be corrupt: {e}")


def extract_artwork(path, suffix):
    if suffix == ".psd":
        return extract_from_psd(path)
    if suffix in (".png", ".jpg", ".jpeg"):
        return extract_from_flat_image(path, suffix)
    fail(f'Unrecognized or unsupported file type "{suffix}". Only .psd and '
         f'transparent .png are handled automatically -- for .kra, export '
         f'the "YOUR FISH DESIGN" layer alone as a transparent PNG from '
         f'Krita, then run it through add_fish_manual.py.')


def main():
    file_url = os.environ.get("FISH_FILE_URL")
    creator = os.environ.get("FISH_CREATOR")
    creator_email = os.environ.get("FISH_CREATOR_EMAIL")
    name = os.environ.get("FISH_NAME", "")
    bio = os.environ.get("FISH_BIO", "")

    if not file_url or not creator or not creator_email:
        fail("Missing FISH_FILE_URL, FISH_CREATOR, or FISH_CREATOR_EMAIL -- "
             "check the workflow's client_payload mapping.")

    data = download_submission(file_url)
    suffix = sniff_extension(data) or Path(file_url.split("?")[0]).suffix.lower()
    tmp_path = Path(f"/tmp/submission{suffix or '.bin'}")
    tmp_path.write_bytes(data)

    artwork = extract_artwork(tmp_path, suffix)
    normalized = normalize_artwork(artwork)
    n = write_fish(normalized, creator, creator_email, name, bio)

    print(f"Added fish{n}.webp for {creator} -- ready to commit.")


if __name__ == "__main__":
    main()
