"""駒台の画像（src/assets/hand.png）の一部を横に引き伸ばし、帯の駒台に使う横長の木目にする。

    python3 hand_strip.py ../../../../src/assets/hand.png hand-strip.jpg      （pillow が要る）
"""
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
band = im.crop((0, int(h * 0.30), w, int(h * 0.30) + 58))
# 木目は横に流れるので、横だけ引き伸ばしても線の細さが変わらない。鏡写しで並べると左右対称の模様が見える
sheet = band.resize((band.width * 6, band.height), Image.LANCZOS)
sheet.save(out, quality=93)
print(sheet.size)
