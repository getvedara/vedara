# Vedara brand assets

The Vedara mark is a V-shaped prompt chevron above a saffron cursor bar. Every logo file in the repo is
generated from the SVGs in this folder.

| File | Use |
| :--- | :--- |
| `vedara-icon.svg` | Full-bleed tile: website favicon and logo, source for the VS Code Marketplace icon |
| `vedara-app-icon.svg` | Tile with OS padding (1024 × 1024): source for the desktop app icons |
| `vedara-mark-on-dark.svg` | Mark only, for dark backgrounds |
| `vedara-mark-on-light.svg` | Mark only, for light backgrounds |
| `vedara-glyph.svg` | Single-color mark (`currentColor`): source for the VS Code icon font |

Geometry, in a 100 × 100 box: V polyline `29,30 → 50,54 → 71,30`, stroke width 12, round caps and joins;
cursor bar at `37,67`, 26 × 9, corner radius 2.5.

Colors: tile `#0b0d10`, V `#f8fafc` (or `#0b0d10` on light backgrounds), cursor saffron `#F59E0B`.

## Regenerating

```bash
# Desktop app icons (PNG, ICO, ICNS, Windows Store sizes); copy the files that already exist in
# src-tauri/icons from the output folder.
npx tauri icon branding/vedara-app-icon.svg -o <temp-dir>

# VS Code Marketplace icon: 128x128@2x.png from this run, copied to extensions/vscode/resources/icon.png
npx tauri icon branding/vedara-icon.svg -o <temp-dir>

# VS Code activity bar and status bar icon font (needs fontTools)
python scripts/brand/build_icon_font.py
```

The website favicon and logo (`web/public/`) are copies of `vedara-icon.svg`. The in-app component
`src/components/common/VedaraLogo.tsx` and the website navbar draw the same geometry inline.
