"""Encode delivery files without editing the original image or its pixels.

Requires Pillow with libwebp support. This development-only command keeps every
RGBA value, including the RGB values of fully transparent pixels. It never
resizes, crops, quantizes, recolours, upscales or overwrites a source file.
"""
from pathlib import Path
from PIL import Image
import hashlib
import io
import json

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "brand" / "delivery-2026-10"
ASSETS = (
    ("vantatalk-greeting-smile.png", "vantatalk-greeting-smile-lossless.webp"),
    ("pos-commerce-intelligence.png", "pos-commerce-intelligence-lossless.webp"),
    ("bookloq-cash-control-v1.png", "bookloq-cash-control-lossless.webp"),
)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for original_name, delivery_name in ASSETS:
        source = ROOT / "public" / "brand" / original_name
        original_bytes = source.read_bytes()
        with Image.open(io.BytesIO(original_bytes)) as original:
            if original.info.get("icc_profile") or original.getexif().get(274, 1) != 1:
                raise ValueError(f"Explicit colour/orientation review required: {source}")
            original_pixels = original.convert("RGBA")
            stream = io.BytesIO()
            original_pixels.save(stream, format="WEBP", lossless=True, exact=True, quality=100, method=6)
            encoded_bytes = stream.getvalue()
            with Image.open(io.BytesIO(encoded_bytes)) as encoded:
                decoded = encoded.convert("RGBA")
                if decoded.size != original_pixels.size or decoded.tobytes() != original_pixels.tobytes():
                    raise ValueError(f"Pixel preservation failed: {source}")
            if len(encoded_bytes) >= len(original_bytes):
                raise ValueError(f"No delivery saving: {source}")
            target = OUTPUT / delivery_name
            target.write_bytes(encoded_bytes)
            if source.read_bytes() != original_bytes:
                raise ValueError(f"Original changed: {source}")
            print(json.dumps({
                "source": str(source.relative_to(ROOT)),
                "delivery": str(target.relative_to(ROOT)),
                "width": original_pixels.width,
                "height": original_pixels.height,
                "originalBytes": len(original_bytes),
                "deliveryBytes": len(encoded_bytes),
                "rgbaSha256": hashlib.sha256(original_pixels.tobytes()).hexdigest(),
                "decodedPixelsIdentical": True,
            }))


if __name__ == "__main__":
    main()
