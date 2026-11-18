from PIL import Image, ImageDraw, ImageFont
import os

S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角渐变背景
radius = int(S * 0.22)
grad = Image.new('RGBA', (S, S))
gd = ImageDraw.Draw(grad)
c1 = (244, 63, 94)
c2 = (129, 20, 60)
for y in range(S):
    t = y / (S - 1)
    color = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=color)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)

# 高光
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([-S * 0.25, -S * 0.55, S * 1.1, S * 0.45], fill=(255, 255, 255, 40))
img.alpha_composite(Image.composite(glow, Image.new('RGBA', (S, S), (0, 0, 0, 0)), mask))

# 播放三角
def tri(cx, cy, r):
    import math
    pts = []
    for ang in (-90, 30, 150):
        a = math.radians(ang)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

d.polygon(tri(S / 2 + S * 0.02, S / 2 - S * 0.02, S * 0.27), fill=(255, 255, 255, 250))
d.polygon(tri(S / 2 + S * 0.02, S / 2 + S * 0.30, S * 0.09), fill=(255, 255, 255, 235))

font_path = 'C:/Windows/Fonts/msyhbd.ttc'
if os.path.exists(font_path):
    font = ImageFont.truetype(font_path, int(S * 0.17))
    text = '聚影'
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((S - tw) / 2 - box[0], S * 0.66), text, font=font, fill=(255, 255, 255, 240))

S512 = 512
large = img.resize((S512, S512), Image.LANCZOS)
os.makedirs('build', exist_ok=True)
large.save('build/icon.png')
large.save('build/icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icon written')
