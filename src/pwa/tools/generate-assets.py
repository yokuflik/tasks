"""מפיק את אייקוני ה-PWA ותמונות מסך הכניסה לתיקיית public. הרצה: python3 src/pwa/tools/generate-assets.py"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3] / "public"
BRAND = (59, 91, 219)
LIGHT_BG = (247, 248, 252)
DARK_BG = (18, 20, 28)

# רוחב, גובה (פיקסלים), בפורטרט
SPLASH_SIZES = [
    (1320, 2868), (1206, 2622), (1290, 2796), (1179, 2556), (1284, 2778), (1170, 2532),
    (1125, 2436), (1242, 2688), (828, 1792), (1242, 2208), (750, 1334), (640, 1136),
]


def glyph(size: int, scale: float, bg, fg=(255, 255, 255)) -> Image.Image:
    """לוח שנה עם סימון וי, מצויר במרכז ריבוע בגודל size. scale = חלק מהריבוע שהצורה תופסת."""
    img = Image.new("RGB", (size, size), bg)
    d = ImageDraw.Draw(img)
    w = size * scale
    x0 = (size - w) / 2
    y0 = (size - w) / 2 + w * 0.04
    r = w * 0.14
    d.rounded_rectangle([x0, y0, x0 + w, y0 + w * 0.88], radius=r, outline=fg, width=max(2, int(w * 0.06)))
    d.line([x0, y0 + w * 0.26, x0 + w, y0 + w * 0.26], fill=fg, width=max(2, int(w * 0.06)))
    for fx in (0.28, 0.72):
        d.rounded_rectangle([x0 + w * fx - w * 0.03, y0 - w * 0.08, x0 + w * fx + w * 0.03, y0 + w * 0.12],
                            radius=w * 0.03, fill=fg)
    pts = [(x0 + w * 0.26, y0 + w * 0.58), (x0 + w * 0.44, y0 + w * 0.73), (x0 + w * 0.76, y0 + w * 0.43)]
    d.line(pts, fill=fg, width=max(3, int(w * 0.075)), joint="curve")
    return img


def main() -> None:
    (ROOT / "icons").mkdir(parents=True, exist_ok=True)
    (ROOT / "splash").mkdir(parents=True, exist_ok=True)
    glyph(180, 0.62, BRAND).save(ROOT / "icons" / "apple-touch-icon.png")  # RGB: בלי שקיפות
    glyph(192, 0.62, BRAND).save(ROOT / "icons" / "icon-192.png")
    glyph(512, 0.62, BRAND).save(ROOT / "icons" / "icon-512.png")
    glyph(512, 0.44, BRAND).save(ROOT / "icons" / "icon-maskable-512.png")  # בתוך אזור בטוח של 80%
    for w, h in SPLASH_SIZES:
        for name, bg, fg in (("light", LIGHT_BG, BRAND), ("dark", DARK_BG, (140, 160, 255))):
            canvas = Image.new("RGB", (w, h), bg)
            g = int(min(w, h) * 0.3)
            canvas.paste(glyph(g, 0.8, bg, fg), ((w - g) // 2, (h - g) // 2))
            canvas.save(ROOT / "splash" / f"splash-{w}x{h}-{name}.png", optimize=True)


if __name__ == "__main__":
    main()
