"""Adds ?v=<content hash> to every /assets/*.css and *.js link in the pages, so browsers fetch new versions
right after a deploy instead of using an old cached copy. Run after changing CSS or JS: python website/version-assets.py"""
import hashlib, pathlib, re

root = pathlib.Path(__file__).parent
for page in root.glob("*.html"):
    html = page.read_text(encoding="utf-8")

    def stamp(m):
        f = root / m.group(1).lstrip("/")
        if not f.exists():
            return m.group(0)
        v = hashlib.sha1(f.read_bytes()).hexdigest()[:8]
        return f'{m.group(1)}?v={v}"'

    new = re.sub(r'(/assets/[\w./-]+\.(?:css|js))(?:\?v=\w+)?"', stamp, html)
    if new != html:
        page.write_text(new, encoding="utf-8")
        print("stamped", page.name)
