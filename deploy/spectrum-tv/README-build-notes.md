# Spectrum Public Access TV — deploy-ready build

A "channel switcher" prototype: a virtual CRT TV cabinet that lets viewers
flip between channels of 17+ years of neurodivergent and Autistic-created
films, animations, and skits.

## What's here

```
index.html   — the whole app (single file, self-contained styles/script)
video/       — NOT in git (see below)
```

`index.html` is a straight copy of the prototype from `G:\SPECTRUM TV\spectrum-public-access-tv_2.html`,
untouched.

## Video files aren't in this repo

The prototype's `video/` folder is ~18GB across 3 files — far beyond what
git (or GitHub) can reasonably hold. `video/` is gitignored here.

Locally, `deploy/spectrum-tv/video` is a Windows directory junction
pointing at `G:\SPECTRUM TV\video`, so local testing works today without
duplicating 18GB on disk. This junction only exists on this machine — it
is not (and cannot be) committed to git.

**Before this goes live**, the channel scheduler's `file:` paths (in the
`<script>` block, search for `VIRTUAL CHANNEL SCHEDULER`) need to point at
externally-hosted video URLs (CDN, video host, etc.) instead of local
`video/...` paths, since the actual video files will never live in this
repo.

CH 001 is the real 24/7 live feed and already uses a YouTube embed — it's
the only channel that isn't a local file.

## Testing locally

Same as feeling-fishy — don't just double-click `index.html`. Serve the
folder over a local web server from inside this folder:

```
python -m http.server 8000
```

then open `http://localhost:8000`.
