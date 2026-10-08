"""Read/render/compress the existing exporter output without rasterizing PDF pages.

Usage: python scripts/validate-native-closing-pdf.py <reference.pdf> [output-directory]
Requires PyMuPDF. The production renderer continues to be Chromium.
"""
import json
import re
import sys
from pathlib import Path
import pymupdf

reference = pymupdf.open(sys.argv[1])
root = Path(sys.argv[2] if len(sys.argv) > 2 else "output/design-consistency")
original = pymupdf.open(root / "full-report.pdf")
original.save(root / "full-report-compressed.pdf", garbage=4, deflate=True, deflate_fonts=True, deflate_images=True, use_objstms=1)
compressed = pymupdf.open(root / "full-report-compressed.pdf")
assert len(original) == len(compressed) == 44
names = ["data-methodology", "definitions", "contacts", "who-we-are"]
details = []
for index, name in enumerate(names):
    page = original[-4 + index]
    small = compressed[-4 + index]
    assert page.rect == reference[index].rect
    assert page.get_text() == small.get_text(), f"Compression changed text on {name}"
    links = [link.get("uri", "") for link in page.get_links()]
    small_links = [link.get("uri", "") for link in small.get_links()]
    assert links == small_links, f"Compression changed hyperlinks on {name}"
    if name == "contacts":
        assert len([uri for uri in links if uri.startswith("mailto:")]) == 45
        assert "mailto:bpappas@lee-associates.com" in links
    assert not any(info["bbox"][2] - info["bbox"][0] > 600 and info["bbox"][3] - info["bbox"][1] > 780 for info in page.get_image_info()), f"Full-page raster on {name}"
    fonts = [{"name": font[3], "type": font[2], "embedded_bytes": len(original.extract_font(font[0])[3])} for font in page.get_fonts()]
    assert all(font["embedded_bytes"] > 0 for font in fonts)
    reference[index].get_pixmap().save(root / f"reference-{name}.png")
    page.get_pixmap().save(root / f"pdf-{name}.png")
    small.get_pixmap().save(root / f"compressed-{name}.png")
    assert page.get_pixmap().samples == small.get_pixmap().samples, f"Compression changed rendered pixels on {name}"
    details.append({"page": name, "text_characters": len(page.get_text()), "mailto_links": sum(uri.startswith("mailto:") for uri in links), "images": len(page.get_image_info()), "fonts": fonts, "compression_text_and_links_unchanged": True, "compressed_pixels_identical": True})
for index, term in enumerate(["Metropolitan Areas Monitored", "Direct Net Absorption", "bpappas@lee-associates.com", "estate firm in North America"]):
    assert term in re.sub(r"\s+", " ", original[-4 + index].get_text())
result = {"pages": 44, "uncompressed_bytes": (root / "full-report.pdf").stat().st_size, "compressed_bytes": (root / "full-report-compressed.pdf").stat().st_size, "closing_pages": details}
(root / "pdf-validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
