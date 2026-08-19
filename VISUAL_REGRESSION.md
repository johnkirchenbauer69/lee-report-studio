# Visual Regression

The approved Q2 PDF is the visual authority. Its rendered pages are committed under `tests/visual/baselines`; Playwright renders the benchmark route at the same fixed page geometry and compares pixels with `pixelmatch`.

## Commands

```bash
npm run test:visual
npm run test:visual:update
```

Use the update command only for an intentional, reviewed design change. CI runs the non-mutating command and uploads actual, expected, diff, and HTML-report artifacts on failure.

## Calibrated floors

| Page                 | Minimum similarity |
| -------------------- | -----------------: |
| Cover                |                96% |
| Overall market table |                95% |
| Market overview      |                88% |
| Market highlights    |                88% |

These are honest whole-page pixel scores, not hand-selected crop scores. The lower chart/photo-page floors account for font availability, anti-aliasing, map/chart rasterization, and source-photo compression. Thresholds should tighten after licensed fonts are bundled and native charts replace approved raster exports.

## Review policy

A passing score prevents accidental drift; it does not replace visual review. Changes to geometry, typography, crops, charts, or baseline files require inspecting the generated full-page screenshots and the Chromium PDF.
