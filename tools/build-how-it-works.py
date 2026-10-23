#!/usr/bin/env python3
"""Builds how-it-works.html from tools/how-it-works.src.html.

The source is plain HTML with LaTeX maths: $$ ... $$ for an equation on
its own line, \\( ... \\) within a sentence. Each is turned into MathML,
which browsers draw themselves, so the page needs no script to show it.

    pip install latex2mathml
    python3 tools/build-how-it-works.py

Edit the source, not how-it-works.html, which this overwrites.
"""

import html
import re
from pathlib import Path

from latex2mathml.converter import convert

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "how-it-works.src.html"
TARGET = ROOT / "how-it-works.html"


def block(match):
    return '<div class="equation">' + convert(html.unescape(match.group(1).strip()), display="block") + "</div>"


def inline(match):
    return convert(html.unescape(match.group(1).strip()))


text = SOURCE.read_text(encoding="utf-8")
text = re.sub(r"\$\$(.+?)\$\$", block, text, flags=re.S)
text = re.sub(r"\\\((.+?)\\\)", inline, text, flags=re.S)
text = text.replace("<!-- BUILD NOTE -->",
                    "<!-- Built from tools/how-it-works.src.html by tools/build-how-it-works.py: edit that, not this. -->")
TARGET.write_text(text, encoding="utf-8")
print(f"wrote {TARGET.relative_to(ROOT)}")
