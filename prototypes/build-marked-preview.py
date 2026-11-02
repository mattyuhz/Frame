"""Inline the marked-frame experiment into the dependency-free app."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = root / "index.html"
start = "  /* MARKED_FRAME_EXPLORATIONS_BEGIN */"
end = "  /* MARKED_FRAME_EXPLORATIONS_END */"
source = app.read_text()
assert source.count(start) == source.count(end) == 1
before, rest = source.split(start)
_, after = rest.split(end)
module = (root / "prototypes/marked-frames.js").read_text().strip()
assert "</script>" not in module
app.write_text(before + start + "\n" + module + "\n" + end + after)
print("Updated the inline marked-frame experiment in index.html")
