"""Builds the VS Code icon font (extensions/vscode/resources/vedara.woff) from the Vedara mark.

The extension shows the logo in the activity bar and status bar as `$(vedara-logo)`, which VS Code
renders from a font glyph (U+E000). The geometry matches branding/vedara-glyph.svg: a V polyline
(29,30)-(50,54)-(71,30) stroked at width 12 with round caps and joins, and a cursor bar at
(37,67) sized 26x9 with corner radius 2.5, all in a 100x100 box.

Usage (needs fontTools): python scripts/brand/build_icon_font.py
"""

import math
import os

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "extensions", "vscode", "resources", "vedara.woff")

UPEM = 1000
ASCENT, DESCENT = 850, -150
SCALE = 13  # font units per SVG unit: the mark spans 54x52 units -> ~702x676
STROKE_RADIUS = 6.0  # half of stroke-width 12
ARC_STEPS = 20


def to_font(x, y):
    """SVG box (y down, centre 50,50) -> font units (y up, centred on the em box)."""
    mid_y = (ASCENT + DESCENT) / 2
    return (round(500 + (x - 50) * SCALE), round(mid_y + (50 - y) * SCALE))


def capsule(p, q, r):
    """Outline of a stroked segment p-q with round caps, as SVG-space points."""
    (x1, y1), (x2, y2) = p, q
    angle = math.atan2(y2 - y1, x2 - x1)
    pts = []
    # Half circle around q, then half circle around p.
    for i in range(ARC_STEPS + 1):
        a = angle - math.pi / 2 + math.pi * i / ARC_STEPS
        pts.append((x2 + r * math.cos(a), y2 + r * math.sin(a)))
    for i in range(ARC_STEPS + 1):
        a = angle + math.pi / 2 + math.pi * i / ARC_STEPS
        pts.append((x1 + r * math.cos(a), y1 + r * math.sin(a)))
    return pts


def rounded_rect(x, y, w, h, r):
    steps = ARC_STEPS // 2
    corners = [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]
    pts = []
    for cx, cy, start in corners:
        for i in range(steps + 1):
            a = math.radians(start + 90 * i / steps)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw_contour(pen, svg_points):
    pts = [to_font(x, y) for x, y in svg_points]
    # Drop consecutive duplicates introduced by rounding.
    cleaned = [pt for i, pt in enumerate(pts) if i == 0 or pt != pts[i - 1]]
    if cleaned[0] == cleaned[-1]:
        cleaned.pop()
    # TrueType outer contours run clockwise (negative signed area with y up).
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(cleaned, cleaned[1:] + cleaned[:1]))
    if area > 0:
        cleaned.reverse()
    pen.moveTo(cleaned[0])
    for pt in cleaned[1:]:
        pen.lineTo(pt)
    pen.closePath()


def build():
    pen = TTGlyphPen(None)
    draw_contour(pen, capsule((29, 30), (50, 54), STROKE_RADIUS))
    draw_contour(pen, capsule((50, 54), (71, 30), STROKE_RADIUS))
    draw_contour(pen, rounded_rect(37, 67, 26, 9, 2.5))
    logo = pen.glyph()

    fb = FontBuilder(UPEM, isTTF=True)
    fb.setupGlyphOrder([".notdef", "vedara-logo"])
    fb.setupCharacterMap({0xE000: "vedara-logo"})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "vedara-logo": logo})
    logo.recalcBounds(fb.font["glyf"])
    fb.setupHorizontalMetrics({".notdef": (500, 0), "vedara-logo": (UPEM, logo.xMin)})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({"familyName": "VedaraIcons", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT, usWinAscent=ASCENT, usWinDescent=-DESCENT)
    fb.setupPost()
    fb.font.flavor = "woff"
    fb.save(OUT)
    print(f"Wrote {os.path.relpath(OUT, ROOT)} (glyph bounds {logo.xMin},{logo.yMin} - {logo.xMax},{logo.yMax})")


if __name__ == "__main__":
    build()
