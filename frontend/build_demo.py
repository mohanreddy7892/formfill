"""Assemble the self-contained FormFill demo page: dist-demo/{demo.js,demo.css} + demo data -> one HTML file."""
import json, sys
from pathlib import Path

HERE = Path(__file__).parent
data = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2])
sys.path.insert(0, str(HERE.parent / "backend"))
from app.ocr import CATEGORIES  # noqa: E402
data["categories"] = [{"id": c, "label": l, "required": r} for c, l, r in CATEGORIES]

js = (HERE / "dist-demo" / "demo.js").read_text()
css = (HERE / "dist-demo" / "demo.css").read_text()
blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>FormFill - interactive demo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>{css}</style>
<style>
  /* published-page requirements: safe areas and a theme-aware shell (form pages stay white paper) */
  :root {{ box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }}
  html {{ scroll-padding-top: env(safe-area-inset-top, 0px); }}
  html, body {{ height: 100%; }}
  body {{ background: var(--paper); }}
  .page text.ink {{ fill: #1b2f7a; }}
  .page .is-auto text.ink {{ fill: #2c6b50; }}
  @media (prefers-color-scheme: dark) {{
    :root:not([data-theme="light"]) {{
      --paper: #13161b; --sheet: #1b1f26; --slate: #e5e8ed; --muted: #9ba4b1; --rule: #2e3540;
      --ink: #5a78e8; --ink-soft: #232c47; --green: #4fbf8b; --red: #f2837b; --amber: #e0a93b; --amber-soft: rgba(224,169,59,.16);
      color-scheme: dark;
    }}
    :root:not([data-theme="light"]) .warn, :root:not([data-theme="light"]) .checks li.warning button {{ color: #e8b95a; }}
    :root:not([data-theme="light"]) .field input:not([type="checkbox"]), :root:not([data-theme="light"]) .doc-table input,
    :root:not([data-theme="light"]) .doc-table select, :root:not([data-theme="light"]) .chips button,
    :root:not([data-theme="light"]) .checks {{ background: #11141a; color: var(--slate); }}
    :root:not([data-theme="light"]) .doc-table input.needs-review {{ background: #2b2413; }}
    :root:not([data-theme="light"]) dialog.docs {{ background: var(--sheet); }}
  }}
  :root[data-theme="dark"] {{
    --paper: #13161b; --sheet: #1b1f26; --slate: #e5e8ed; --muted: #9ba4b1; --rule: #2e3540;
    --ink: #5a78e8; --ink-soft: #232c47; --green: #4fbf8b; --red: #f2837b; --amber: #e0a93b; color-scheme: dark;
  }}
</style>
</head>
<body>
<div id="root"></div>
<script type="application/json" id="demo-data">{blob}</script>
<script type="module">{js}</script>
</body>
</html>
"""
out.write_text(html)
print(f"{out} {out.stat().st_size // 1024} KB")
