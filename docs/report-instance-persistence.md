# ReportInstance persistence contract

Report Studio treats the server-side `ReportInstance` JSON document as the
authoritative durable report. Browser state is an editable working copy and
local recovery is only a safety net for changes that have not been accepted by
the server.

## Pre-change reproductions

The audit findings were reproduced on the unmodified `origin/main` tree before
this contract was implemented:

- Canvas mutations changed React/template state but left the server
  `ReportInstance.pages` unchanged; a fresh reload restored the stale server
  page.
- Forty same-ID writes reused `<target>.<process.pid>.tmp`; 39 failed with
  rename/`ENOENT` collisions in the stress reproduction.
- A partial object containing only an ID and 19 empty narrative records crossed
  the repository boundary because storage used a TypeScript cast rather than a
  runtime validator.
- Two R1 clients could save in sequence and the later R1-derived full object
  silently replaced the first client's R2 state.
- Bound-text input appended an override for each input event, while undo/redo
  restored only the template snapshot; overrides were neither history-coherent
  nor durably saved.

## Storage identity and revisions

- `schemaVersion` identifies the persisted storage shape. Version `1` is the
  first explicit ReportInstance storage schema.
- `revision` is a monotonically increasing integer assigned by the repository.
  New reports are created at revision `1`; every successful write increments
  the current revision exactly once.
- Legacy ReportInstances without either field are normalized in memory to
  `schemaVersion: 1` and `revision: 0`. Reading a legacy file does not rewrite
  it. Its first successful mutation persists the current schema at revision 1.
- Unknown schema versions and legacy documents missing business-critical data
  are rejected. Migration never invents report data, pages, narratives, or
  readiness decisions.

## Editor document mutations

The editor persists only the document-owned fields it is allowed to change:

- expanded report pages and their elements/styles;
- coalesced manual overrides for bound content.

`PATCH /api/report-instances/:id/document` accepts those fields plus the
client's `baseRevision`. Under the per-report repository lock, the server loads
the latest instance, verifies the revision, applies the document patch,
validates the complete result, increments the revision, and atomically replaces
the JSON file. Narrative, readiness, source, provenance, and external-job state
are retained from the current server instance rather than from a stale browser
copy.

If the base revision is stale, the server returns `409` with the current
revision. It does not merge ambiguous changes or overwrite either side. The
browser keeps its local working copy and recovery record and exposes a conflict
save state for later resolution.

## Atomic writes and serialization

Every write for one report ID runs through the same per-instance promise queue.
Different report IDs use different queues. Each disk write uses a unique UUID
temporary filename in the destination directory, validates the serialized
document, atomically renames it over the target, and removes any leftover
temporary file after failure. A failed task releases the queue so later saves
can proceed.

## Autosave and local recovery

Committed report editor mutations move through
`clean -> dirty -> saving -> saved`. Pointer moves and keystrokes are coalesced
by a short debounce; an interaction still creates the existing undo boundary.
Failures remain `error`, and stale revisions remain `conflict`; neither state is
reported as saved.

While dirty, the browser stores the report ID, base revision, pages, and manual
overrides in a report-specific recovery record. A matching server revision can
restore and resume autosave. If the server revision advanced, the recovery data
is retained and the editor reports a conflict instead of silently choosing a
side. Successful server persistence clears recovery. Reload/navigation uses a
minimal `beforeunload` warning while report changes are unsaved.

## Manual overrides and history

Bound-text edits update the visible page and a single override identified by
`elementId + bindingPath` as one logical mutation. Repeated input replaces that
override rather than appending one record per event. Undo/redo snapshots include
both the template pages and manual overrides, so the displayed value, audit
state, local recovery, and durable server patch remain consistent.

## Deferred Phase 1B work

This contract deliberately does not change published-template mutability,
referenced-asset deletion, Salesforce session refresh, raw Salesforce IDs in
QA output, missing-metric chart rendering, transient crop/table modes, image
preflight, rapid-generation orphan handling, API URL acceptance, reports whose
source draft is later deleted, template-draft stale-write protection, Report
Library/navigation UX, PDF UI polish, accessibility, or iconography. Template
draft concurrency remains on the existing persistence contract because sharing
the ReportInstance revision protocol would materially broaden this phase and
risk published-template governance.
