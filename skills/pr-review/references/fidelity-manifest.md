# Fidelity manifest

`docs/design/<module>/fidelity.json` tells `scripts/design-capture.mjs` which views to capture, in the reference and
in the app, and which token values to expect. `/ship:design-me` writes the reference half at intake. The builder
writes the app half, keeps it true as places are built, and commits it in the spec's PR.

```json
{
  "reference": "reference.html",
  "reference_view": "#place={place}&look={look}&theme={theme}",
  "reference_scope": ".mny",
  "looks": ["pro", "play"],
  "themes": ["dark", "light"],
  "viewports": { "desk": { "width": 1280, "height": 800 }, "phone": { "width": 390, "height": 844 } },
  "settle_ms": 300,
  "places": {
    "overview": { "app": "/money" },
    "pocket": { "app": "/money/pocket" },
    "settings": { "reference": "#place=settings&look={look}&theme={theme}" }
  },
  "app": {
    "serve": "pnpm --filter @lifeline/shell exec vite preview --port 4317 --strictPort",
    "cwd": ".",
    "url": "http://localhost:4317",
    "timeout": 180,
    "storage_state": "shell/e2e/.auth/demo.json",
    "init": "localStorage.setItem('money.look', '{look}'); localStorage.setItem('money.theme', '{theme}')",
    "scope": "[data-module=money]"
  },
  "tokens": {
    "--background": { "pro-dark": "#181c20", "pro-light": "#f4f1e8", "play-dark": "#23211e", "play-light": "#fff7e8" }
  }
}
```

| Key | Means |
|---|---|
| `reference`, `reference_view` | The reference page, relative to the manifest, and the URL hash that opens one view of it. A place may override the hash with its own `reference`. |
| `reference_scope`, `app.scope` | The element that holds the module. Contrast is checked inside it, and tokens are read from it. |
| `looks`, `themes`, `viewports` | Every combination captured. One look or one theme is a one-item list. Viewports come from the handoff. |
| `places.<id>.app` | The app path for that place. A place with no `app` is captured on the reference side only, so a place not built yet is left out of the app side. |
| `app.serve` | Optional. A command that serves a build of the app, started and stopped by the script. Without it, something must already answer at `app.url`, or the caller passes `--app-url`. |
| `app.storage_state`, `app.init` | How a capture signs in and picks a look and theme. `init` runs before the page's own scripts, with `{look}`, `{theme}` and `{place}` filled in. |
| `tokens` | The app tokens the handoff maps onto, with the value expected per `<look>-<theme>`, read from `app.scope`. |

`{place}`, `{look}` and `{theme}` are filled into every path and hash.

## The report

`<out>/report.json` lists every shot: place, look, theme, viewport, side, the PNG's path, and either `error` or:

- `contrast`: every visible text inside the scope below 4.5:1 (3:1 for large text), with its colours. Text on an
  image or gradient is skipped, so look at it in the screenshot.
- `contrastChecked`: how many texts were measured.
- `tokens` (app side): each expected token, the value found, and `ok`.
