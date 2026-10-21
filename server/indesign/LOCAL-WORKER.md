# Controlled Windows desktop export worker

Status: candidate fallback, not an executed or licensed unattended service.

Implemented foundations: `desktopInput.ts` verifies the entire captured asset population, copies the pinned master/script and writes an input-ready manifest only after readback. `desktopSession.ts` refuses occupied sessions; `fileDesktopJournal.ts` holds a workstation-wide lock across uncertain executions and preserves immutable attempt records. The Windows COM adapter and operator command are implemented, but have not yet been validated against a full native assembly run. An input-ready manifest is never advertised as a finished InDesign package.

The installed InDesign Desktop and the validated versioned-template scripts can support an operator-started quarterly export session. That does not establish entitlement to operate an unattended, shared or hosted service. The organization is checking Adobe Admin/Developer Console access; Creative Cloud membership is not treated as InDesign API or Server entitlement.

The local worker should use a dedicated Windows session and a single-job queue. It must refuse jobs while unrelated InDesign documents are open, never attach to or overwrite an operator's unsaved document, and never kill InDesign automatically. A stalled execution becomes a recoverable failed job requiring operator attention. Each job works in its own directory and copies the pinned master before opening it.

Both web and local applications should submit the same frozen export manifest. The worker can retrieve authenticated jobs through an outbound connection; it should not expose Windows COM or a public inbound desktop endpoint. Tokens and Salesforce credentials are never embedded in INDD, JSX or downloaded packages. Export jobs contain frozen report data and managed asset copies, not Salesforce access.

Required before production use:

- Confirm Adobe licensing for the intended operator/automation model.
- Demonstrate a full Classic and Geographic export with the installed InDesign version.
- Record master/script hashes and the exact input report revision.
- Validate native content, all links/fonts, zero overset, PDF page count, save/reopen and package relocation.
- Validate IDML through an actual import; otherwise omit it.
- Verify disconnect, crash, restart and duplicate-job behavior without touching unrelated documents.

Operational fit: a designated Marketing operator starting a batch on an available workstation may suit quarterly production. It depends on workstation availability and requires a human recovery path. It is not equivalent to an always-available cloud export service. The API/Server option remains preferred for shared unattended availability if entitlement and runtime testing support it.

Adobe references reviewed during discovery:
- https://developer.adobe.com/firefly-services/docs/indesign-apis/guides/working-with-custom-scripts-api/
- https://www.adobe.com/products/indesignserver/buying-guide.html

## Operator command and adapter

`npx tsx scripts/run-indesign-desktop.ts <prepared-job-directory> <dedicated-workstation-journal-directory> --operator-started`

Use only reviewed, locally prepared input with the approved release master/script. The command rechecks the report, master, script and asset hashes, then takes the durable workstation lock. InDesign 2026 must already be running. The adapter uses the active COM object; it never launches, restarts or kills Adobe. It checks occupancy again inside Adobe immediately before the versioned build script. The build receives the absolute job directory as its first script argument and must work only in that directory. A changed or missing input fails before Adobe execution. An inspection or execution timeout leaves the lock for operator recovery, and does not cancel an in-flight COM operation or replay the job.

This is an execution adapter, not a complete native report renderer. The approved design still needs the production assembly script/master contract, full native round-trip verification and acceptance before the command is used for Marketing output. It prints `execution-finished`, never `accepted`, on script completion. No actual Adobe job was run to validate this adapter in the QA-diagnostics change.
