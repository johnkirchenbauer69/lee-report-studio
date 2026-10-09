# Lee Report Studio: UX/UI audit and design proposal

Date: October 9, 2026. Decision status: **proposal for approval; major restructuring is not implemented.**

## Executive assessment

**Current UX/UI grade: 62/100.** This is a heuristic assessment, not a measured customer satisfaction score. Task entry and document management score 9/20; editor ergonomics 13/20; feedback and recovery 13/20; consistency and discoverability 12/20; desktop accessibility and local operation 15/20. The application has substantially more working capability than its navigation communicates. Its major weakness is presenting template authoring, report production, and export as a collection of editor controls.

The recommendation is a task-oriented Home plus Reports, Templates, and Market Assets. Keep managed images and fonts as one shared library reachable from the editor; do not add top-level Asset Library or Settings destinations until they offer independent tasks. A dashboard is justified because the current entry route immediately selects a template draft or restores one remembered report, while providing no report browsing destination. The proposed Home must be a small task launcher, not a metrics dashboard.

Existing strengths: a seven-step creation wizard; separate calculation scope and detailed-page selection; 44-page report generation; independent Pages scrolling; undo/redo and grouped transforms; image replacement and crop; chart/table controls; report autosave, revision conflicts and recovery; template version persistence and published immutability; narrative approval; advisory export QA; snapshot-only Market Assets export with manifest and omission warnings. Preserve these.

## Evidence and investigation boundaries

The working directory is `C:\Users\BrandonPappas\Downloads\lee-report-studio`. Baseline HEAD: `141da1457f9b75e390a0f8e3a9a3019657905cdc`. Original branch: `codex/local-market-assets-integration-20261008`; working branch: `codex/ux-audit-local-launch-20261009`. No tracked edits existed at entry. Untracked `.claude/`, ZIPs, and verification PDFs were retained. The original branch has no upstream and has 13 commits reachable beyond local `origin/main`; do not publish this branch assuming it contains only UX work. GitHub PR #40 is merged at `c44618b680fd1d78dee43cbeee547a22edcd8041`; remote main matched that SHA when checked. No open PRs were returned.

Reviewed implementation: `src/main.tsx` query-based entry routes; `App.tsx` state, initialization, history, persistence, selection, keyboard handling, sidebar, toolbar, export and dialogs; `CanvasElement.tsx`; `Inspector.tsx`; `CreateReportWizard.tsx`; `NarrativeWorkspace.tsx`; `ValidationPanel.tsx`; `MarketAssetWorkspace.tsx`; application CSS; client stores/recovery; API routes/repositories; PDF and Market Assets services; guarded browser-test configuration and existing tests.

The live Chrome application was observed with a genuine Q3 2026 saved report. Its header and cover both showed Q3 2026. This does **not** support the hypothetical Q3-header/Q2-cover defect. The cover needs investigation per document if another report reproduces it; do not change bindings globally. [Live saved-report observation](evidence/ux-ui/live-saved-report-before.png).

Playwright task simulations used disposable test storage and the existing global isolation guard. They traversed all nine editor tools, all seven creation stages, a synthetic 44-page saved report, I-55 navigation and export inventory. Screenshots cover 1366×768, 1440×900, 1920×1080, and 2560×1440. Mock data/model tests are not live Salesforce or real-user research. Licensed font import, actual Windows DPI settings, concurrent human editing, and empirical long-report performance were not measured. A 44-page navigation test is not a drag-performance benchmark.

Initial baseline screenshots are in [current evidence](evidence/ux-ui/current/); the second baseline task initially failed because the icon became part of the accessible Market Assets link name. The implemented aria label corrects that. An intermediate JSX insertion error was caught and corrected before final validation. Final results are recorded in [validation and delivery](ux-validation.md), including failed attempts.

## Screen and workflow inventory

Counts below are UI actions after a ready application unless stated otherwise. Typing/selecting values counts as one action each. Variable paths are shown as ranges or formulas. Inspection paths and task simulations are distinguished; absent functions are not invented.

| Area / user intent | Current route and controls | Steps and friction | Safe simplification / capability boundary |
|---|---|---|---|
| Startup / continue working | `npm run dev`; `/` immediately renders editor; startup chooses draft then optionally restores remembered report | Terminal + URL; no task choice; restoration only identifies the last report | Desktop launcher implemented; Home proposed |
| App shell / navigate | Header, 10 rail destinations including Market Assets, left panel, stage, Inspector, footer | Tools and a full-page export route mix; footer type was 8px | Separate global destinations after approval; rail link styling fixed |
| Template Library | Templates → mode card → every version → Open/Open Draft/Create New Version/Delete; overflow rename/duplicate/history | 2 actions to open a visible draft; scrolling grows with versions; Open and Duplicate repeated in menu | Drafts/Published/History groups; retain version IDs secondary |
| Saved reports | Restore one LocalStorage ID; narrative-review URL can remember a chosen report; Market Assets report picker lists snapshots | No editor-side report list to open arbitrary prior work; API capability is not a UI library | Reports workspace using existing repository; approval required |
| Create report | Header, Pages and template panel entries → seven-stage dialog | 8 primary actions from Create through Open Editor for default data, plus chosen inputs; source and two geography scopes require explanation | Preserve seven-stage logic initially; later improve labels/defaults and possible stage consolidation |
| Pages | Pages → independent list with schematic thumbnails; editable name/size/margins; Add/Duplicate/Delete/Move; drag reorder | 2 actions to select a named visible page; extra scrolling for 44 pages; thumbnail only first 8 element rectangles | Add search/market grouping after approval; keep name list and reorder parity |
| Elements and layers | Elements → shape grid and reverse-order layer list → selection → Inspector/context menu | 2 actions for visible layer; insertion and organization mixed; no layer drag hierarchy | Rename section to Objects/Layers after approval; preserve Shift multiselect and group IDs |
| Text | Text presets; selected text Typography textarea; canvas double-click chooses supported editing mode | 2–3 actions plus input; position/effects precede content in long Inspector | Put content first after approval; distinguish selection and editing instructions |
| Images | Images gallery; selected image Inspector Replace Image/fit/crop/zoom; upload replacement path | 3 actions plus file selection for replacement; crop commits when leaving, Escape exits without commit | Keep behavior, add contextual explanation; do not add a second crop engine |
| Uploads | Uploads tool, hidden file input and asset cards, server import/dedupe/rejection feedback | 2 actions plus file dialog; routine toast disappears after 1.8s | Persistent failed-file summary proposed; asset persistence unchanged |
| Fonts | Approved families, face diagnostics and import; managed server assets | Family approval/licensing states are meaningful; technical metadata dense | Default family cards, details disclosure; retain managed-face safeguards |
| Data | DataBrowser against presentation data, bindings and reconciliation drilldown | Source terms/paths appropriate for researchers but heavy for marketing | Plain labels plus Advanced path/source detail; preserve raw authority |
| Inspector | Selection-aware text/image/chart/table/native closing controls; multi-selection Arrange/Combine | Existing `details` sections mostly open; Position & Size, Fill/effects before Typography | Reorder and collapse Effects after approval with browser parity tests |
| Charts | Chart Data/Type/Series/Axes & Gridlines/Legend & Typography | Choose layer → relevant section → control; dense series controls | Chart title and common display settings first; preserve source bindings |
| Tables | Content/geometry; header/body/totals typography/shadows; cell/row/column edit selection; display overrides | Strong precision but deeply nested technical settings | Content/Style/Layout/Data tabs or sections; do not change semantic override keys |
| Narratives | Wizard stage 6 or `?narrativeReview=<id>`; market list, editor, Save Edit/Approve/Unlock, context and broker panel | Narrative review route is not a persistent editor destination | Add report-level Narratives action after approval; preserve generated/edited/approved/stale distinctions |
| Validation / QA | Validate or QA rail → blockers/warnings/data completeness → Select or reconciliation | 1 action to review; 2 to navigate actionable warning; full font/image preflight runs at export | Empty-state explanation implemented; unify wording and check timestamp later |
| Save draft | Template Save persists to library; local document recovery timer; report autosave 650ms with two bounded retries | Templates: 1 click; reports: 0 save clicks; very small footer communicates status | Larger footer implemented; prominent state/time/conflict action proposed |
| New version | Template Save as version or library Create New Version → draft with next semantic version | 1 action from active template; no user-name dialog; report duplication absent in editor | Name-first draft workflow proposed; do not imply template version duplicates a report |
| Publish | Template Publish saves then publishes, makes version immutable | 1 action; no concise finalization review dialog; template operation is not report publication | Deliberate publish summary proposed; preserve repository revision/read-only guards |
| PDF | Export PDF → preflight → blockers or review/export-warning dialog → Chromium, browser fallback on supported failure | 1 action clean; 2 with warning acceptance; progress is button/toast; warning selection navigates element | Keep warning allowance, technical blockers, font/image checks and export paths |
| Market Assets | Full-page `?marketAssets=1`; saved report → markets → categories → PNG options → preview → start → download | With all defaults 4 actions plus navigation; I-55 Charts subset 9 actions from rail including selections | Already has select/clear-all, search, preview, warnings and download; do not reimplement these |
| Dialogs / notifications | Wizard, delete-draft modal, export-warning modal, drilldown, context menu; routine toast | Modal roles present; no shared focus-trap primitive; all toast strings were prefixed ✓ even on failure | Removed universal success glyph; live status added; shared dialog accessibility future work |
| Recovery | History (up to 50 snapshots), report overrides included; report recovery before autosave; template conflict recovery; unload warning for reports | Refresh/history boundaries differ by document type; quota failures only console | Keep recovery; visible recovery choice and disk-failure feedback proposed |

### Interaction model verified in code

Shift selection, Ctrl/Cmd+C/V/D, group/ungroup, context-menu layer ordering, locked-element handling, grouped translate/rotate/resize, snapping and undo already exist. Do not scope them as wholly new work. Table double-click editing and image crop have explicit state reset on document/page changes. Keyboard handling excludes INPUT/TEXTAREA/SELECT except editor undo/redo; this exception needs deliberate review against text-entry expectations. Ctrl+S and Ctrl+Y are not implemented in the examined handler. Escape exits crop/table modes, but should not be described as a universal deselect shortcut. Fit currently means fixed 72% zoom, not geometry-based fit; its tooltip now says so.

Page deletion is captured by the mutation history and the last-page guard; version open/save replaces history through editor navigation helpers. History is not a persisted session recovery log. Save does not mean Publish. Source snapshots remain immutable while report pages and display overrides are saved separately.

## Ranked usability findings

Severity reflects task impact: Critical prevents a core task with no recovery; High makes core work difficult/risky; Medium causes repeated friction; Low is local polish. **No demonstrated Critical defect** was established. Specific data-loss scenarios below are risks supported by code, not observed losses.

| ID / severity | Screen and current behavior | Impact / usability principle | Recommended change and expected benefit | Complexity / dependencies |
|---|---|---|---|---|
| H1 High | Entry opens editor; no report library destination | Users cannot recognize how to continue arbitrary saved work; recognition over recall | Home + Reports list → predictable entry/reopening | L; report-summary API, document handoff, dirty/conflict guard |
| H2 High | Template/report distinction relegated to small subtitle; template versions remain shown during report editing | Risk of choosing template operations when intending report edits | Distinct document scope banner and context-specific commands → fewer wrong-document actions | M; existing permissions and generation pinning |
| H3 High | Header treats layout helpers, Publish, JSON and exports alike | Excess choices; labels wrap into multiple lines at laptop widths | Two document/action bands and View menu, JSON under source download → clearer priority | M; approval; keyboard/focus parity |
| H4 High | Report autosave/recovery/error states appear in tiny footer; template recovery can be mistaken for library save | Users may leave without recognizing a save conflict | Persistent named save state, retry/reopen action and last-save time → trustworthy feedback | M; distinguish server save, recovery and immutable published mode |
| H5 High | Template Publish immediately saves and finalizes | Error prevention weaker than draft-delete flow; no concise consequence review | Review dialog with name/version/scope/validation and explicit Publish → deliberate finalization | M; server revision checks; no stronger QA rules inferred |
| H6 High | Narrative review isn't a report-level editor action; generated/approved content lives in another route/stage | Editorial task becomes hard to rediscover | Persistent Narratives command scoped to current report → round-trip editing | M; unsaved narrative text handling, revision refresh |
| M1 Medium | Inspector mostly opens every section with geometry/effects first | Content tasks require scanning many irrelevant controls | Content, Style, Layout, Effects, Data, Advanced disclosure → shorter scan path | M; map controls per type, persist disclosure by type |
| M2 Medium | Rail combines Market Assets navigation with element tools; link inherits unreadable browser-link appearance | Inconsistent interaction and contrast | Global navigation separation proposed; link contrast/focus/name corrected now | S now / M architecture |
| M3 Medium | 44-page list has no search or market section grouping | Many scrolling actions to find named market | Search + section labels and active page reveal → direct retrieval | M; stable page identity; no recalculation |
| M4 Medium | Fit is hard-coded zoom, stage minimum width and permanent panels | Canvas may clip despite apparent Fit; scarce laptop space | True fit using container/page geometry and optional panels → spacious canvas | M; ResizeObserver, zoom limits, ruler padding; approval |
| M5 Medium | Initial QA does not run every PDF technical preflight | Apparent clean state may change at export | Explain what has run, when and what export adds → fewer surprises | S explanation done / M centralized check state |
| M6 Medium | Error and success share 1.8s toast and previously ✓ prefix | Failure looks successful and vanishes before reading | Remove universal ✓ (done); persistent error details/retry later | S/M; structured notification severity |
| M7 Medium | Dialogs have roles but no common focus trapping/restoration | Keyboard can reach background or lose task position | Shared dialog primitive with initial/return focus and Escape policy | M; wizard unsaved/busy and publish distinctions |
| M8 Medium | Market Assets report list initially empty while fetch runs; one loading flag covers details/preview/start | Empty-state and busy-stage ambiguity | Separate initial load/retry and step-specific text → accurate status | S; preserve frozen preview/revision contract |
| M9 Medium | Market Assets retains previous job when selecting another report; job stage section below can describe old job | A completed package could be mistaken for the new selection | Label job report/period prominently; separate job history from current configuration | M; current job identity and polling; approval for flow change |
| M10 Medium | Template library version list repeats actions, name secondary to vX.Y.Z | Users need software-version knowledge | Human names + Draft/Published/History, semantic version secondary | M; rename already supported, no schema migration needed |
| M11 Medium | Recovery quota/import errors can be console-only or generic | User cannot judge whether work is recoverable | Persistent recovery/storage warning with manual source-download escape route | M; failure injection; avoid silent overwrite |
| L1 Low | Glyph buttons have ambiguous accessible names; rail active state visual only | Keyboard/screen reader recognition | Names for undo/redo/zoom, rail pressed state, wizard current step (done) | S; no document behavior change |
| L2 Low | Labels/state text 8–10px; application CSS mixed with print styles | Eye strain, fragile polish changes | 11px floor for secondary status, 13px body tokens; UI-specific CSS | S/M; preserve publication metrics |
| L3 Low | README describes five wizard steps and LocalStorage-only templates | Setup guidance conflicts with actual app | Correct operation/storage documentation | S |
| L4 Low | Large production bundles despite one active page | Potential first-load/interaction cost; not a measured failure | Lazy-load workspaces and Inspector subsections after profiling | M; export/print route separation |

## Current versus proposed workflow maps

These targets are hypotheses for user testing, not measured savings. Proposed wizard keeps sample/import/Ascendix options, independent calculation/page scopes, readiness and narratives. No source defaults are changed before approval.

| Task | Current flow / minimum interactions | Proposed flow / target | Approval or remaining dependency |
|---|---|---|---|
| 1 Open app | Terminal → start API/Web → browser → editor | Desktop shortcut → readiness → Home (one launch action) | Launcher ready; Home approval |
| 2 Create report | Create → Template Continue → Period Continue → Source Continue → Geographies Continue → Load & Validate → Review → Open (8 primary actions) | Home Create → choose period/template/source + explicit scopes → validate → narrative review → editor (target 5–7, preserve optional detail) | Approve step organization; measure novice and experienced paths |
| 3 Edit report | Restore last ID or narrative-review route → page → element → content | Reports → named report → Pages search → content (target 3–4 + typing) | Reports navigation/state handoff |
| 4 Edit master | Templates → version Open Draft → page/element | Templates Drafts → named draft → focused editor (2 + selection) | Distinct master scope, published read-only |
| 5 Save draft | Template Save (1); report autosave (0) | Same writes; persistent Saved/Saving/Unsaved/Conflict beside title | State presentation, no template autosave assumption |
| 6 New version | Save as version (1) produces semantic name | More → Duplicate as new draft → human name → Create (3) | Additional step justified by document identity; report duplication separate |
| 7 Publish | Publish → automatic save/publish (1) | Publish → review name/scope/checks → Confirm (2) | Approve deliberate checkpoint |
| 8 PDF | Export → maybe warnings → Export anyway (1–2) | Export PDF → same preflight/warning choice (1–2) | Preserve advisory vs blockers |
| 9 Market assets | Rail → saved report → subset selection → Preview → Start → Download (5 defaults / 9 I-55 Charts subset) | Reports row → Export assets carries report → subset → Preview → Start → Download (4 defaults / 8 subset) | Explicit deep link, immutable snapshot binding |
| 10 Narratives | Wizard stage or separate review URL → market → edit → Save Edit → Approve (4 after route) | Report Narratives → market → edit → Save Edit → Approve (5 including command) | Discoverability improves, not necessarily fewer clicks |
| 11 QA | Validate → warning Select (2), return tools to edit | Review checks → issue Go to page/element (2) + recommended action | Plain labels, same severity semantics |

## Proposed architecture and component hierarchy

```text
ApplicationShell
  PrimaryNavigation: Home / Reports / Templates / Market Assets
  WorkspaceOutlet
    HomeWorkspace: task actions + recent reports + recent drafts
    ReportLibrary: search / period / status / modified sort / open / exports
    TemplateLibrary: Drafts / Published / History / name / version / actions
    MarketAssetWorkspace: existing saved-snapshot workflow
    DocumentWorkspace
      DocumentHeader: back / title / document kind / status / save feedback
      DocumentActions: narratives (reports) / review / export / template publish
      EditorToolbar: undo / redo / zoom / fit / view controls
      ToolPanel: Pages / Objects / Add / Assets / Data
      CanvasViewport (existing document rendering)
      PropertiesPanel: content / style / layout / effects / data / advanced
  SharedDialog / NotificationRegion / KeyboardHelp
```

Route changes need a deliberate migration from query entry points. Keep print/benchmark/narrative-review URLs working. Never remount a dirty editor just to show Home: flush/report save, preserve template draft recovery, and block conflicted handoffs with a readable choice. Existing local recovery keys and file repositories remain readable. No published template body is migrated. New report-summary fields must be derived from persisted instances; unsupported rename/archive/duplicate actions stay absent until backed by repository operations. Current generation timestamps are not last-modified timestamps.

## Visual design specification

Use publication brand identity while keeping application controls independent of canvas typography and print CSS. Suggested UI tokens:

| Family | Specification |
|---|---|
| Typography | Segoe UI/system sans; app title 20/28 semibold, section 16/24 semibold, control/body 13/20, metadata 11/16; report fonts untouched |
| Colors | Brand navy `#163a63`, darker nav `#0f2d4f`, action `#2767ad`; text `#172033`, secondary `#526174`; canvas surround `#e8ebef`, surface white, border `#d7dee7` |
| Feedback | Success text `#226546` on `#eef8f1`; warning `#805600` on `#fff7df`; error `#a12835` on `#fff0f1`; pair text/icon with color |
| Spacing | 4/8/12/16/24/32; 16px panel inset, 24px workspace separation; 8px input gaps |
| Radius / shadow | Inputs/buttons 6px, cards/dialogs 10px; restrained panel borders; dialog shadow only for elevation |
| Buttons | 36px standard target, 32px dense tools; one filled primary per task region; secondary outline; text action for reversible supporting tasks; disabled action has a reason |
| Inputs | Visible persistent labels, 36px height, inline help/error, error association via described-by; no placeholder-only labels |
| Navigation | Global labels distinct from editor tools; active destination and pressed tool state; collapsible panel keeps reachable toggle and current context |
| Panels | Left 240px default (200–360 adjustable), right 300px (260–420); minimum center 480px; widths stored as UI preference, never template settings |
| Toolbar | 56px document band + 40px edit band; wrap actions at laptop/zoom widths; no source/JSON action styled like Save |
| Dialogs | Clear title/consequence/action; return focus; trap focus; 90vh max with body scroll, persistent footer; Escape cannot discard in-flight work |
| Loading/empty | Identify operation and next action; distinguish fetching from no records; retain error/retry until resolved |
| Save status | Report: autosaving → saved time / failed / conflict. Template: unsaved draft / saved to library / local recovery only. Published: read-only. Never label recovery alone “Saved” |
| Keyboard | Keep actual shortcuts; add Ctrl+S only with correct document-mode save and text context; do not advertise Ctrl+Y until implemented; reference reachable from Help |

All tokens are proposals. Verify contrast, focused/hover/disabled states and 125%/150% browser zoom before broad rollout. Current small-screen wrapping and focus improvements are separate low-risk CSS scoped to `.app-shell`, excluding publication content.

## Wireframes

Open [annotated wireframes](ux-wireframes.html). Eight representative screens: Home, Create Report, Reports, Templates, Editor, Inspector, Market Assets, Validation. These are static concept screens with annotations and intentional sample labels, not working product routes. They show the approval choices rather than claiming a finished redesign. Screenshot overview: [wireframe evidence](evidence/ux-ui/wireframes.png).

## Roadmap and migration

| Order | Increment | Size | Exit criterion |
|---|---|---|---|
| Done | Focus/names, rail link, wizard progress, honest QA empty state, readable status, toolbar wrapping, independent desktop launcher | S/M | Typecheck/build, regression suite, screenshot comparisons, isolated launch/restart/stop |
| 1 approval | Home + Reports library + document scope header | L | Open any saved report, retain last-report restoration/recovery; search/filter real summaries; no data writes on browsing |
| 2 approval | Split toolbar and editor/global navigation; panels collapse/resize; true Fit | M/L | All existing actions reachable at four sizes and zoom; fit full page; dirty handoff safe |
| 3 approval | Inspector per-type content-first sections; page search | M | Text/image/chart/table task completion with control parity; remembered disclosure |
| 4 approval | Name-first draft/history library, publish review | M | Published immutability/revisions unchanged; clear duplicate vs version vs report scope |
| 5 approval | Integrated narrative action; QA recommendations; structured notifications/shared dialogs | M/L | Save/approve/revise round trips; keyboard focus restoration; persistent failures |
| 6 | Profile and lazy-load large routes; compare human marketing workflows | M | Trace actual input-to-paint and task timings; reduce unnecessary rerenders only where measured |

Autosave for templates is **not** an independently safe quick win. Reports already autosave. Template autosave needs conflict/recovery semantics, published-mode exclusion and explicit review; manual Save remains supported. Future layer drag hierarchy, persistent group outline, multi-page selection/hiding and archive/compare features require model/API design. Existing grouped transforms and Shift multiselect are preserved; do not build duplicate systems.

## Approval decisions

1. Adopt Home / Reports / Templates / Market Assets, with managed assets inside the editor rather than additional empty global sections.
2. Adopt distinct Report Editing / Template Design headers, split action/edit bars, and optional panels; retain all advanced tools.
3. Use content-first Inspector sections and name-first Drafts / Published / History; add deliberate template publish review.
4. Keep the seven-step wizard for the first migration, improve terminology and contextual guidance, then decide whether consolidation measurably helps.
5. Add a report-scoped Narratives command and report-to-Market-Assets handoff; preserve snapshot-only exports and existing approval states.

These decisions remain pending. Safe initial changes and launcher do not constitute approval of the proposal. No merge, deployment, Salesforce write, source calculation change, report-contract migration, or publication redesign is included.
