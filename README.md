# Kell Lighting Planner

A lightweight Progressive Web App for planning lighting layouts on photos of ceilings or walls.

Built for **Kell Electricals Limited**.

## Features

- Upload or capture a photo of a ceiling / wall
- Draw **strip lights** and **cove lights** freehand
- Place **spotlights** (single or double, round or square)
- Adjust size, colour, glow
- Erase, edit, move, undo, clear
- Pinch-to-zoom and pan
- Ruler tool for rough measurements
- Local auto-save (IndexedDB) — works offline
- Export annotated photo as JPEG with Kell Electricals watermark
- Installable as a PWA on phone / desktop

## How to use

1. Open `index.html` in a modern browser (or serve the folder).
2. Tap **Photo** → choose or take a picture.
3. Select a tool and draw / place lights.
4. Tap **Save** to export the marked-up plan.

## Local development

```bash
# Simple static server (any will do)
npx serve .
# or
python3 -m http.server 8080
```

Then open http://localhost:8080

## Deploy

This is a pure static site (HTML + JS + CSS + icons).  
You can host it on:

- GitHub Pages
- Netlify / Vercel / Cloudflare Pages
- Any static file host or your own server

No backend required.

## Tech

- Vanilla JavaScript
- HTML5 Canvas
- IndexedDB for local persistence
- PWA manifest

## License

Proprietary — Kell Electricals Limited.  
Internal / client use.
