"""アイコンの駒の輪郭（public/icon.svg）から、☗ ☖ ⛊ ⛉ の4字だけの書体を作る。

    python3 koma_font.py koma.woff2      （fonttools と brotli が要る）
"""
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

OUT = sys.argv[1]
UPM = 1000
ADV = 820
H = 850
BASE = -38
CX = 410

# public/icon.svg の輪郭: 頂点 (307,0)、肩 (83,121)-(530,119)、裾 (0,688)-(593,689)。幅 594 高さ 691
S = H / 691
half_base = 594 / 2 * S
half_shoulder = (530 - 83) / 2 * S
# 小さい文字で丸く見えないように、頂点の高さを 30% まで立てる（アイコンは 17%）
shoulder_y = BASE + H * (1 - 0.30)


def outline():
    return [
        (CX, BASE + H),
        (CX + half_shoulder, shoulder_y),
        (CX + half_base, BASE),
        (CX - half_base, BASE),
        (CX - half_shoulder, shoulder_y),
    ]


def inset(points, d):
    """凸多角形を内側へ d だけ寄せる（時計回りの点列）"""
    n = len(points)
    lines = []
    for i in range(n):
        (x1, y1), (x2, y2) = points[i], points[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        length = (dx * dx + dy * dy) ** 0.5
        nx, ny = dy / length, -dx / length  # 時計回りの内向き（y 上向き）
        lines.append(((x1 + nx * d, y1 + ny * d), (dx, dy)))
    out = []
    for i in range(n):
        (p, u), (q, v) = lines[i - 1], lines[i]
        den = u[0] * v[1] - u[1] * v[0]
        t = ((q[0] - p[0]) * v[1] - (q[1] - p[1]) * v[0]) / den
        out.append((p[0] + u[0] * t, p[1] + u[1] * t))
    return out


def turned(points):
    cy = BASE + H / 2
    return [(2 * CX - x, 2 * cy - y) for x, y in points]


def draw(contours):
    pen = TTGlyphPen(None)
    for c in contours:
        pts = [(round(x), round(y)) for x, y in c]
        pen.moveTo(pts[0])
        for p in pts[1:]:
            pen.lineTo(p)
        pen.closePath()
    return pen.glyph()


o = outline()
i = inset(o, 90)
glyphs = {
    ".notdef": draw([]),
    "sente": draw([o]),
    "gote": draw([o, list(reversed(i))]),
    "senteTurned": draw([turned(o)]),
    "goteTurned": draw([turned(o), list(reversed(turned(i)))]),
}
cmap = {0x2617: "sente", 0x2616: "gote", 0x26CA: "senteTurned", 0x26C9: "goteTurned"}

fb = FontBuilder(UPM, isTTF=True)
fb.setupGlyphOrder(list(glyphs))
fb.setupCharacterMap(cmap)
fb.setupGlyf(glyphs)
fb.setupHorizontalMetrics({g: (ADV, 0) for g in glyphs})
fb.setupHorizontalHeader(ascent=880, descent=-120)
fb.setupNameTable({"familyName": "Koma Mark", "styleName": "Regular"})
fb.setupOS2(sTypoAscender=880, sTypoDescender=-120, usWinAscent=880, usWinDescent=120)
fb.setupPost()
fb.font.flavor = "woff2"
fb.save(OUT)
print("saved", OUT)
