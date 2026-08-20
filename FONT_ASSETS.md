# Managed font assets

## Import and metadata

Organization fonts are server-managed assets. Upload accepts `.ttf`, `.otf`, `.woff`, `.woff2`, or a ZIP bundle. ZIPs are read in memory and never extracted by path. Absolute paths, drive paths, and `..` traversal are rejected; archive entry count, expanded size, individual face size, upload count, and request size are bounded.

`fontkit` parses embedded OpenType metadata. The stored record includes family, numeric weight, normal/italic style, PostScript name, SHA-256 checksum, source scope, safe storage key, size, version slot, and license metadata when the bundle includes an OFL/LICENSE file. Filenames are display labels only. The supplied Nunito bundle resolves to one `Nunito Sans` family with 14 faces, seven embedded weight values, normal/italic variants, and SIL OFL metadata.

Exact checksum duplicates are skipped. A different checksum for the same family/weight/style slot is retained as a new version and surfaced as a conflict. Invalid font bytes are rejected even when the extension looks valid.

## Storage and serving

The local development adapter writes binaries under `${LEE_DATA_DIR}/assets/fonts/organization/<sha256>.<ext>` and writes an atomic ignored manifest at `${LEE_DATA_DIR}/assets.json`. `server/data` remains the default; set `LEE_DATA_DIR` to relocate private data. Stored paths are resolved under the asset root before serving. Responses use private immutable caching.

The `FileSystemAssetStore` is an adapter boundary. Production should replace it with private S3-compatible object storage plus organization/tenant authorization, encrypted persistence, retention/deletion policy, malware scanning, audit records, and short-lived signed delivery URLs. Raw organization font URLs must not be public or cross-tenant.

## Editor and PDF behavior

The Fonts panel groups faces by family and shows real weight/style availability, license status, version, checksum tooltip, and per-face removal. Inspector controls only offer combinations that actually exist; `font-synthesis: none` prevents artificial bold or italic. Each chosen managed face stores its asset ID and checksum alongside semantic family/weight/style values.

One centralized registry generates deterministic `@font-face` rules and waits for every referenced face plus `document.fonts.ready`. The editor and isolated print route call that same registry. Report instances carry checksum-pinned font references. Export preflight blocks a missing or changed managed face, and Chromium waits for font readiness before emitting the PDF. The offline fallback refuses managed-font reports so it cannot silently substitute Helvetica.

Built-in system families remain available through the same Inspector option model, but they do not pretend to have a managed asset/checksum. Final brand-fidelity output should use approved managed faces.
