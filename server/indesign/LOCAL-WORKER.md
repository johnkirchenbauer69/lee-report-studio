# Operator-started InDesign Desktop export

This application runs locally on Windows with installed InDesign 2026. Adobe API and Server licensing are not part of this release. Unattended hosted execution is unavailable. Direct IDML generation is a future option and does not block Desktop export.

Save the canonical report, close other InDesign documents, and click **Export to InDesign**. The local application prepares the exact saved revision, captured assets, linked vector charts/maps, photographs, approved fonts, and native layout instructions. The explicit click may activate InDesign through its supported scripting interface. It never closes unrelated documents or kills Adobe.

The package becomes downloadable only after native assembly, zero overset/missing-link/substituted-font checks, save/reopen, relocation, and independent 44-page PDF checks pass. It contains the INDD, InDesign-exported PDF, frozen report and input manifests, linked artwork, permitted fonts, and license notices. Native text and tables are editable; charts and maps remain linked vectors. IDML is omitted until actual InDesign import validation passes. Commercial fonts are for authorized internal organization use, not public redistribution.

Each job uses an isolated directory. Source reports, the approved publication, and existing Marketing files remain unchanged. Checksums bind report revision, layout, script, assets, and derived artwork before dispatch. A durable workstation lock serializes jobs across processes; immutable job claims prevent automatic replay.

Jobs default to the application's data directory under `native-exports`. Set `LEE_NATIVE_EXPORT_DIR` to a shorter local directory when the installation path is deeply nested; InDesign's Document fonts discovery can fail on long Windows paths. This changes only export scratch/package storage, not report storage.

If export fails, retain its directory and journal. A timeout can leave Adobe execution indeterminate, so never retry automatically, delete the claim, or clear the lock while execution may still be active. Inspect the specific attempt and Adobe document state first. Recovery archives only the verified completed attempt's workstation lock; a corrected export receives a new identity. The journal is under `%LOCALAPPDATA%\Lee Report Studio\native-export-journal`.

`scripts/native-export-smoke.ts` validates a subset or complete saved report with the production capture, input preparation, desktop adapter, and assembly script. The standalone `run-indesign-desktop.ts` command can dispatch reviewed prepared inputs; script completion alone is not package acceptance.

The modular capture, manifest, session, and validation contracts allow a future approved execution provider without changing report-data architecture. No cloud entitlement is implied by Desktop validation.

## Isolating capture failures

Run a single affected page, then a small surrounding sample before a complete capture. Set `LEE_NATIVE_PREPARE_ONLY=1` with `native-export-smoke.ts` to stop after verified input preparation. Once preparation succeeds, use `run-indesign-desktop.ts` with that prepared directory rather than recapturing it. Never run heavy browser exports and Adobe assembly concurrently.

Capture owns its Chromium process and retains `capture-events.jsonl`, `chromium-stderr.log`, and a layout checkpoint for each completed page. Events identify page/element, navigation, page crashes, disconnects, process exit, cleanup, and sampled worker/Chromium memory on Windows. Each page has a 90-second deadline in addition to the ten-minute overall deadline. Deadline failures happen before Adobe dispatch. Partial page checkpoints are diagnostic artifacts, not approved resumable inputs; only the complete hash-verified prepared input may be dispatched independently.

If InDesign fails during session inspection, inspect Windows Application events and try opening Desktop normally. A startup crash is distinct from capture or report assembly. Do not rerun capture, clear journal claims, alter fonts, or reinstall system components to work around an unverified startup problem. Preserve the prepared input until the installed application works again.
