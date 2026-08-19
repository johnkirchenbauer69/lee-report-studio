# LEE Report Studio

A polished browser-based, data-aware report template editor designed to turn structured Salesforce/Ascendix data into editable, institutional-quality commercial real estate reports.

## Editor capabilities

- React + TypeScript + Vite application
- Multi-page report template schema
- Professional creative-tool shell with contextual sidebar, canvas, layer list, inspector, data browser and QA panel
- Multi-select, four-corner resize handles, rotation, keyboard nudging and alignment/distribution controls
- Rectangles, rounded rectangles, circles, ellipses, lines, triangles and diamonds
- Grid, margin guides, element/page/grid snapping and visible snap guides
- Pixel/inch unit switching using the documented `96px = 1in` CSS reference
- Solid and two/three-stop linear-gradient fills, stroke styles, opacity and corner radius
- Full typography controls plus workspace-local font upload
- Image/logo upload, asset browser and contain/cover/stretch/original fit modes
- Interactive image crop mode with pan, zoom and numeric crop coordinates
- Proportional resizing for grouped elements
- Draggable page thumbnail reordering
- Pixel/inch rulers with draggable custom guides and guide snapping
- Disk-backed asset API with browser-local fallback when the API is unavailable
- Undo/redo history with drag/resize interactions recorded as one transaction
- Copy/paste, duplicate, group/ungroup, z-order controls and custom context menu
- Duplicate / delete elements and pages
- Lock / hide element controls
- Design Mode vs Data Preview Mode
- Structured data binding (`market.vacancy_rate`, etc.)
- Formatting engine for percentages, SF, integers, decimals, currency and $/SF
- Dynamic table renderer
- Dynamic SVG bar chart renderer
- Sample Chicago industrial report data
- Sample cover, overall market page and submarket template page
- Validation for unresolved bindings and out-of-page geometry
- LocalStorage persistence behind a replaceable persistence service
- JSON export of the current template
- Deterministic, full-document PDF export in template page order
- Clean separation between data, document schema, rendering, validation and editor UI

This is intentionally a focused report-production MVP, not a general-purpose Canva replacement.

## Run locally in VS Code

### Prerequisites

Install:

- Node.js 20+ (Node 22 recommended)
- Git
- Visual Studio Code

### Commands

Open the integrated VS Code terminal in the project root and run:

```bash
npm install
npm run dev
```

The development command starts the editor and its local asset API together. Open:

```text
http://localhost:3000
```

### Production build

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Delete selection | `Delete` / `Backspace` |
| Copy / Paste | `Ctrl/Cmd+C` / `Ctrl/Cmd+V` |
| Duplicate | `Ctrl/Cmd+D` |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Nudge / large nudge | Arrow / `Shift+Arrow` |
| Group / Ungroup | `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G` |
| Zoom in / out / reset | `Ctrl/Cmd++` / `Ctrl/Cmd+-` / `Ctrl/Cmd+0` |

## Push to a NEW GitHub repository

Create an empty repository in GitHub first. Do **not** initialize it with a README if you want the cleanest first push.

Then, from the project root in VS Code:

```bash
git init
git add .
git commit -m "Initial LEE Report Studio MVP"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
git push -u origin main
```

If GitHub prompts you to authenticate, use your normal GitHub authentication flow or GitHub CLI.

### GitHub CLI alternative

If `gh` is installed and authenticated:

```bash
git init
git add .
git commit -m "Initial LEE Report Studio MVP"
git branch -M main
gh repo create YOUR-ORG/YOUR-REPO --private --source=. --remote=origin --push
```

## If the GitHub repository already exists

```bash
git init
git add .
git commit -m "Initial LEE Report Studio MVP"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
git pull origin main --rebase
# Resolve any conflicts if Git reports them.
git push -u origin main
```

## Project structure

```text
lee-report-studio/
├─ src/
│  ├─ components/
│  │  ├─ CanvasElement.tsx
│  │  ├─ DataBrowser.tsx
│  │  ├─ Inspector.tsx
│  │  └─ ValidationPanel.tsx
│  ├─ data/
│  │  ├─ sampleData.ts
│  │  └─ sampleTemplate.ts
│  ├─ engine/
│  │  ├─ bindings.ts
│  │  └─ validation.ts
│  ├─ types/
│  │  └─ report.ts
│  ├─ styles/
│  │  └─ app.css
│  ├─ App.tsx
│  └─ main.tsx
├─ ARCHITECTURE.md
├─ ROADMAP.md
├─ package.json
└─ README.md
```

## Architecture principle

Do not bind the final visual template directly to arbitrary Salesforce fields.

Use:

```text
Salesforce
   ↓
Ascendix / data services
   ↓
Normalized Report Data Model
   ↓
Binding engine
   ↓
Template
   ↓
Renderer / editor
   ↓
Report instance
   ↓
PDF / images
```

This keeps Salesforce implementation details separate from the report schema and allows the UI/template to survive backend field changes.

## Replacing the mock data with Ascendix

The current sample dataset is in:

```text
src/data/sampleData.ts
```

The next integration step should be to add a data-provider abstraction such as:

```ts
export interface ReportDataProvider {
  getIndustrialMarketReport(params: {
    period: string;
    market: string;
    submarkets: string[];
  }): Promise<IndustrialMarketReportData>;
}
```

Then implement:

- `MockReportDataProvider` for local development
- `AscendixReportDataProvider` for production

The Ascendix provider should call the existing MCP/API layer and normalize results into the report data model before the UI sees them.

## Asset storage

Uploaded images, logos and fonts are written by the local API to `server/data/assets`; its generated manifest and files are intentionally gitignored. Set `LEE_DATA_DIR` to move this data root. If the API cannot be reached, the editor keeps uploads as browser data URLs so design work can continue.

## PDF rendering

Export PDF composes every visible page directly from the report schema with fixed metadata and stable object ordering. Text, fills, shapes, tables and images are rendered without depending on browser print layout. The current renderer uses PDF standard fonts; production brand-font embedding and richer chart output remain preflight items.

## Current limitations

The current project proves the editor/data-binding architecture but is not yet a production replacement for Canva. Important next items include:

- Persist templates/reports to a backend/database
- Real authentication and permissions
- The included backend asset service is local disk storage; production deployment still needs authenticated S3-compatible storage and access controls.
- Text supports professional box-level typography but not mixed rich-text runs inside one element.
- Production chart library or richer SVG chart engine
- Repeating components and repeating pages
- Conditional visibility / conditional formatting UI
- Server-hosted PDF jobs, brand-font embedding and production preflight
- Template versioning and immutable published versions
- Report instance snapshots
- Data provenance and manual-override tracking
- Ascendix/Salesforce integration
- Full pixel-level reconstruction of the current Industrial Market Report template

## Recommended next milestone

Do not add broad design features yet. The strongest next milestone is:

1. Recreate the current Industrial Market Report template with pixel-level fidelity.
2. Formalize the normalized Industrial Market Report data schema.
3. Wire the existing Overall Market Table payload into the data-provider layer.
4. Add repeat-page generation for selected submarkets.
5. Add a production PDF renderer.
6. Compare generated output side-by-side with the existing Canva report.

That will determine whether the architecture can truly replace the production workflow before time is spent on secondary editor features.
