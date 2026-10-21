# Controlled Windows desktop export worker

Status: candidate fallback, not an executed or licensed unattended service.

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
