# Goldfish Brain Atlas — Interactive Viewer

Interactive web atlas of goldfish brain coronal sections built from the atlas in
Hayun et al. 2024, *Comparative Transcriptomics of Vertebrate Forebrain Regions* (atlas pp. 69–93).

Live site: https://AlexLazarovich.github.io/GoldfishBrainAtlas/

## What ships
The deployed site is fully self-contained under `docs/`:
```
docs/
  index.html             # lateral view + acronym browser
  viewer.html            # section viewer (measurement on by default)
  app.js viewer.js style.css
  sections/              # 25 coronal section PNGs (s01..s25.png)
  data/
    acronyms.json        # {acro: full name}
    sections.json        # {n: {file, w, h}}
    labels.json          # {n: [{acro, name, x, y, ...}]}
    scales.json          # {n: {um_per_px, ref_um, p1, p2}}
```

## Features
- Lateral side-view with clickable per-section tabs (rostral → caudal).
- Acronym browser: filter by acronym or full name; pick a region → grid of
  sections it appears in (each thumbnail shows the per-section µm/px scale).
- Section viewer opens inline in a modal (no full-page nav). Measurement mode
  is on by default — click two points to read the distance in µm; the value is
  drawn above the line.
- Optional anatomy-label overlay (off by default): each acronym pin shows the
  acronym on hover/click, useful for orienting yourself in unfamiliar sections.
- Search box inside the viewer jumps to any acronym in the current or another section.

## Local-only tools (not in repo)
The data-prep / authoring tools live next to the repo locally under
`tools/` (gitignored). They are not needed to use or rebuild the site.
