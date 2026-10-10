# UX audit: validation and delivery evidence

October 9, 2026. These are automated task simulations and heuristic findings,
not real-user research. Live Salesforce and licensed-font installation were not
part of this run.

## Delivered changes

- Audit, workflow inventory, ranked findings, proposed architecture, design
  tokens, migration roadmap and approval decisions: [audit](ux-ui-audit.md).
- Eight annotated static concept screens: [wireframes](ux-wireframes.html).
- Application-only quick wins: readable Market Assets link and accessible name,
  active tool state, focus outlines, named undo/redo/zoom controls, explicit Fit
  tooltip, JSON download explanation, wizard current-step feedback, honest QA
  empty state, larger footer status and wrapping action labels. Routine failures
  no longer automatically receive a success checkmark.
- One-process Windows launcher with readiness, duplicate-session detection,
  browser opening, logs, explicit port conflicts and guarded owned-process
  shutdown. Desktop shortcut installed through Node/VBScript without changing
  Windows execution policy. [Operation guide](windows-launcher.md).

Publication canvas styles, source data calculations, binding contracts, template
bodies and published versions were not redesigned. The shutdown integration is
conditional on a launcher-owned IPC channel; ordinary server startup retains its
existing behavior. Busy accessors and active-request tracking prevent stopping
the owned API during current work.

## Commands and results

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Passed after correcting an intermediate JSX insertion error |
| Production build | `npm run build` | Passed; existing large-bundle warning remains (ExcelJS and main application chunks exceed 500kB) |
| Test ownership | `npm run test:ownership` (included in test command) | Passed |
| Unit/integration initial | `npm test` | 947 passed, 1 existing Market Assets image-retention test timed out at 5 seconds |
| Unit/integration rerun | `npm test -- --maxWorkers=2` | **101 files / 948 tests passed**; failing test completed within its original timeout, no test weakening |
| Initial guarded browser check | `npx cross-env PLAYWRIGHT_PORT=3015 PLAYWRIGHT_API_PORT=8815 PLAYWRIGHT_MOCK_MCP_PORT=8816 playwright test tests/visual/qa-advisory-pages.spec.ts --config playwright.config.ts` | 2 passed |
| Baseline audit | Same ports, `tests/visual/ux-audit.spec.ts` | Panel/wizard/size test passed; I-55 task failed on icon-prefixed accessible link name; corrected with aria label |
| Intermediate audit rerun | Same ports, `UX_AUDIT_PHASE=implemented` | Failed due JSX insertion error; corrected; these attempts are not clean validation |
| Full browser regression | Same ports, `UX_AUDIT_PHASE=implemented`, `playwright test --config playwright.config.ts` | **75 passed / 12 inherited guarded skips**, 21.1 minutes; complete 323-file all-market package, PNG parity and Chromium section PDF passed |
| Final audit captures | `npx cross-env UX_AUDIT_PHASE=implemented PLAYWRIGHT_PORT=3025 PLAYWRIGHT_API_PORT=8855 PLAYWRIGHT_MOCK_MCP_PORT=8856 playwright test tests/visual/ux-audit.spec.ts --config playwright.config.ts --output test-results/ux-final` | **3 passed**, 54.6 seconds; panel/wizard/desktop sizes, 44-page I-55 inventory, contextual Inspectors/narrative/narrow window |
| Launcher integration | `node scripts/windows/verify-launcher.mjs` | **7 checks passed** with isolated mock storage; ready / duplicate / stop authorization / busy-stop refusal / graceful stop / restart / occupied port |
| Setup | `node scripts/windows/install.mjs --skip-install` | Build passed; Desktop shortcut created |
| Hidden Windows startup | `wscript.exe scripts/windows/Launch.vbs <node-path>` under isolated test environment on 8840/8841 | WScript returned successfully; launch controller reached ready; normal stop acknowledged HTTP 200 |
| Diff whitespace | `git diff --check` | Passed; Git emitted normal LF/CRLF conversion notices |

The rejected initial standalone isolated startup command returned “blocked by
policy” without a detailed reason. The repository's guarded browser test setup
successfully started its isolated servers. The PowerShell installer attempt was
blocked by Windows execution policy; it was replaced with `Install.cmd` and a
Node/VBScript installer, rather than changing the execution policy.

## Acceptance task coverage

Interaction counts are UI actions, not elapsed-time measurements. Existing
regression tests can seed documents through APIs/LocalStorage; that does not
prove that the normal UI provides a report library.

| Requested task | Coverage / result | Current friction or remaining gap |
|---|---|---|
| 1 Launch without terminal | Hidden WScript launch and readiness verified; Desktop shortcut installed | Existing manually-started server needs its own normal shutdown; launcher does not adopt/kill it |
| 2 Find Create report | Header action used in simulation | Discoverable button exists; task-oriented entry awaits approval |
| 3 Open saved report | Remembered-ID restore and 44-page fixture reopen tested | No arbitrary saved-report editor browser; Reports proposal addresses this |
| 4 Find submarket page | Pages → named I-55 page; 2 actions plus scrolling | No search/grouping yet |
| 5 Edit narrative | Existing narrative browser suite exercises edit/save/approve/revise | Rediscovery from editor needs proposed report-scoped action |
| 6 Chart display | Existing chart controls/rendering suite; Inspector capture | Dense Inspector remains; content-first mapping requires approval |
| 7 Replace image | Existing image styling/replacement and persistence browser tests | Licensed-font-dependent variants retain inherited guards |
| 8 Save draft | Existing template/report save, revision and recovery suite | Template Save differs from report autosave |
| 9 Understand save state | Footer enlarged; report dirty/saved/conflict behavior exercised by existing suite | Human comprehension not measured; prominent header state proposed |
| 10 Separate version | Existing template Save as / version tests | Report duplication/version UI is not implemented |
| 11 Identify published | Template library status and read-only browser regression | Name-first Published grouping proposed |
| 12 Validate | Validate/QA and export preflight exercised | Check scope explanation improved |
| 13 Resolve warning | Warning-to-element selection exercised (2 actions) | Navigation verified; no blanket claim all warnings were resolved |
| 14 Export PDF | Existing warning confirmation, native pages, narrative and Chromium tests | Technical blockers and warning allowance retained |
| 15 I-55 Charts assets | Synthetic I-55 selection/inventory and existing download/PNG parity tests | 9 actions from rail for a subset; snapshot authority unchanged |
| 16 Return dashboard | Not implemented | Approval required for Home/navigation restructuring |
| 17 Recover accidental edit | Existing editor undo/redo, crop Escape, report/template conflict and persistence tests | History is bounded and not persistent across all document transitions |

No unsupported grouping, multi-page hiding, archive, comparison or report
duplication feature was added. Core capabilities remain reachable.

## Screen and display evidence

- [Baseline](evidence/ux-ui/current/) and
  [implemented](evidence/ux-ui/implemented/) captures show all editor tools and
  seven creation stages, 44-page I-55 navigation, and Market Assets inventory.
- The four requested desktop sizes were captured with recorded toolbar bounds.
  Both baseline and implementation had no document horizontal overflow in the
  measured standard-title case. Baseline small-width labels wrapped within
  individual buttons; the quick win wraps the toolbar itself and keeps labels
  intact. This is improved readability, not proof of faster task completion.
- [Launcher ready](evidence/ux-ui/launcher-ready.png) and
  [built interface](evidence/ux-ui/launcher-built-app.png).
- [Wireframe editor](evidence/ux-ui/wireframe-editor.png) and
  [Inspector variants](evidence/ux-ui/wireframe-inspector.png).
- Browser zoom/Windows display scaling were not directly measured. A CSS zoom
  approximation and narrower-window captures are separately labeled; they must
  not be presented as native DPI/browser zoom results.

The full suite regenerated tracked Market Assets evidence. This run's artifacts
were copied to `evidence/ux-ui/regression-market-assets`; the 8 pre-existing
tracked evidence files were restored from the unchanged baseline so prior QA
evidence is not replaced by this task. The synthetic benchmark packages contain
4 files for I-55 charts, 51 for three markets and 323 for all 19 markets.

All three final audit tasks passed. The contextual-control test initially used
“Market Indicators” as a navigator label, while this app calls that page “Market
Overview,” and then looked for a table on the property-highlight page instead
of the overview. Those test assumptions were corrected from actual page and
element inventories; application content was not changed to satisfy the tests.
The final captures include text/image/chart/table Inspectors, narrative review,
a 1093×614 window and a separately labeled 125% CSS zoom approximation.
The reused export fixture intentionally restates sample data to Q3. Audit-only
fixture captions were aligned to that synthetic period so screenshots do not
misrepresent a Q2-header/Q3-body test setup as a genuine saved-report defect.

## Git and review boundary

Branch: `codex/ux-audit-local-launch-20261009`. Base HEAD remains
`141da1457f9b75e390a0f8e3a9a3019657905cdc`; work is uncommitted and unpushed.
The branch inherits prior local Market Assets integration work, so publishing it
would not be a UX-only PR without separate branch reconciliation. No merge,
deployment, Salesforce write, authoritative content edit, or configuration
replacement was performed by this task.

The user stopped Computer Use with Escape. Desktop interaction was stopped;
noninteractive validation continued. Major Home/library/editor/workflow changes
remain pending the approval decisions in the audit.
