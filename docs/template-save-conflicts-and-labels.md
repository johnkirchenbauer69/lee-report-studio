# Template save conflicts and version labels

## What prompted this

A real incident: a draft template (`industrial-market-report` v1.14.0) was
open in a browser tab from earlier in the day. A separate maintenance script
touched the same draft. When the tab's "Save" button was eventually clicked,
its in-memory content — based on an hours-old load — silently replaced
everything on the server, including a shape union and several unrelated
edits made in between. Unlike `ReportInstance` saves (which already carry a
`revision`/`expectedRevision` optimistic-concurrency contract — see
`docs/report-instance-persistence.md`), template draft saves had none:
whichever save landed last won, unconditionally.

Separately, template versions were identifiable only by an auto-incrementing
`major.minor.0` number (`v1.14.0`), making it hard to tell drafts apart by
intent ("which one was the Q3 2026 working copy?").

## Save conflict protection

`StoredTemplateVersion` now carries a `revision` — a monotonically
increasing counter mirroring `ReportInstance.revision`, incremented only by
`FileSystemTemplateRepository.saveDraft`.

- The client sends `expectedRevision` (the revision it loaded) with every
  `PUT /api/templates/:id/versions/:version`.
- If the stored version's current revision no longer matches,
  `TemplateVersionConflictError` is thrown and the route responds `409` with
  `code: "TEMPLATE_VERSION_CONFLICT"`, `baseRevision`, `currentRevision` —
  the same shape `ReportInstanceConflictError` uses for reports.
- The rejected save is never discarded. `src/services/templateRecovery.ts`
  (mirroring `reportRecovery.ts`) stashes it in `localStorage`, keyed by
  `id@version`, with `baseRevision` set to the revision the *conflict*
  reported as current (not the stale one the edit started from).
- Reopening that exact draft (`App.tsx`'s `openTemplateRecord`) checks for a
  stashed recovery:
  - If the draft is still at exactly that revision (nobody has changed it
    again since the conflict), the recovery is restored into the editor and
    cleared — safe, because nothing else happened to lose track of.
  - If the draft has moved further since, the recovery is left in place and
    the editor shows the server's current content, with a status-bar message
    naming both revisions — never silently reapplied over content the user
    has not seen.
- Save As New Version is unaffected by any of this: it always creates a new
  row and never competes with a concurrent save on the version it started
  from, so it doubles as the built-in resolution path — "someone else
  changed this draft; save my edits as a new version instead."

This intentionally does not attempt a content-level three-way merge (as
report instances do not either): the guarantee is that an edit is never
silently thrown away or silently overwritten, not that two concurrent edits
are combined.

### A related bug this surfaced

Building and testing the recovery path surfaced a real, separate defect: the
app's mount-time bootstrap effect (which opens the most recently touched
draft on load) ran twice under React 18 `StrictMode` (active in `npm run
dev`/Playwright's dev-mode webServer, though not in a production build). Two
concurrent `openTemplateRecord` calls raced — the first found and applied a
stashed recovery and cleared it; the second, finding no recovery left,
silently overwrote that recovery with the plain server copy. `App.tsx` now
guards that effect with an `initialLoadStarted` ref so it only ever runs
once. This is plausibly one contributor to the original incident above, since
it would happen on every reload while `npm run dev` is used, which is the
normal local development workflow.

## Version labels

`TemplateVersionSummary.label` is a free-text, optional per-version display
label, distinct from `name` (which mirrors `template.name` and flows into
the exported PDF's title metadata — renaming a version never touches that).

- `FileSystemTemplateRepository.rename(id, version, label)` is a pure
  metadata update: it never touches `template`, `checksum`, or `revision`,
  so it works uniformly on draft, published, and archived versions and never
  conflicts with a concurrent content save.
- `PATCH /api/templates/:id/versions/:version/label` exposes it.
- The Template Library card shows `label || name` as its heading; the
  version number and status remain shown underneath unchanged. A new
  "Rename" action in each card's "•••" menu opens an inline text field.
- `createVersion` carries the source version's label forward to the new
  draft by default (renaming is expected to happen occasionally, not on
  every new version).

## What this does not do

- No merge UI for genuinely concurrent edits to the same version — the
  resolution path is "save as a new version," same as report instances have
  no merge UI either.
- `createVersion`, `publish`, and `deleteDraft` are not revision-guarded;
  only `saveDraft` (the operation that actually overwrites content in place)
  is. A concurrent publish/delete race is a narrower, lower-likelihood
  window than the plain-Save race this fixes, and is left for a future pass
  if it proves necessary in practice.
