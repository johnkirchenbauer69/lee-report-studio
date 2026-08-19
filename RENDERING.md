# Rendering

## Browser pages

The browser renderer consumes report pages with fixed `816 x 1056` CSS-pixel geometry. The same document schema drives editor display, benchmark screenshots, and the isolated print route.

## Production PDF path

`POST /api/render/pdf` creates a transient render job. The Chromium renderer loads the requested fixed print route, waits for fonts/images, applies print CSS, and writes all visible pages in document order. `GET /api/render-jobs/:id` returns state and the completed PDF when ready.

Reference output is four US Letter portrait pages (`612 x 792` PDF points). The renderer uses a fixed timestamp/metadata strategy and avoids browser chrome, margins, and responsive layout.

## Browser fallback

`src/services/pdfExport.ts` retains the `pdf-lib` compositor for offline/local fallback. It renders schema primitives directly and supports image crop geometry. It is not the preferred fidelity path because browser text/layout and SVG behavior are better preserved by Chromium.

## Preflight

Export blocks or warns on:

- unresolved bindings and report-schema errors
- provenance conflicts
- missing or unloaded images
- unavailable fonts
- non-finite/out-of-page geometry
- unapproved overflow

Intentional bleed/overflow must be marked explicitly with `allowOverflow`.

## Deployment requirements

The current job service is local and in-memory. Production requires authenticated requests, authorization, a durable queue, worker concurrency/timeouts, an approved Chromium image, object storage, signed downloads, telemetry, cleanup policies, and SSRF-safe route construction.
