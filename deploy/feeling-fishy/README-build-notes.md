# Feeling Fishy — deploy-ready build

This is the same aquarium page, restructured for real hosting instead of
one giant self-contained file.

## What changed

- All 45 demo fish, the logo, both vending-inlay images, the 4 sound effects,
  the printable template, and the background video were pulled out of the
  base64 blobs in the `<script>` tag and saved as real files below.
- `index.html` now points at those files (`images/fish/fish1.webp`, etc.)
  instead of embedding them as text. The page went from **7.8 MB** to about
  **70 KB** — everything else is now separate, cacheable files.
- No other logic was touched. The layout, animations, config options, and
  comments are all exactly what they were before.

```
index.html
images/
  logo.webp
  inlay-print.webp
  inlay-krita.webp
  fish/fish1.webp … fish45.webp   (swap these for real submissions)
audio/
  music.mp3, chime.mp3, pluck.mp3, drag.mp3
video/
  background.mp4
files/
  fish-template.png               (the downloadable "create your fish" template)
```

## Before it goes live

1. **Swap in your real links.** Near the top of the `<script>` block, `SETTINGS`
   still has the placeholder values from the demo:
   - `submitUrl` → your Monday.com WorkForm share link
   - `donateUrl` → your Zeffy donation page link
2. **Add your own fish.** Replace the files in `images/fish/` with real
   submissions, and add matching entries to the `FISH` array further down
   in the script (name, creator, bio, which image file, etc.).
3. **Replace `templatePsd` / `templateKrita`** with your actual layered
   source files in `files/`, or set them to `null` to hide those buttons.

## Testing locally

Don't just double-click `index.html` — the chime sound effect is loaded
with `fetch()`, which most browsers block on the `file://` protocol. Serve
the folder over a local web server instead, e.g. from inside this folder:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`. This also matches how it'll behave once
it's actually hosted.
