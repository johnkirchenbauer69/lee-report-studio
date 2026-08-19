# LEE Report Studio

A functional MVP for a browser-based, data-aware report template editor designed to turn structured Salesforce/Ascendix data into editable, institutional-quality commercial real estate reports.

## What is included now

- React + TypeScript + Vite application
- Multi-page report template schema
- Canva-like editing shell with page rail, canvas, element layers, inspector, data browser, QA panel
- Drag-to-move and resize handles
- Add text / rectangle elements
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
- JSON export of the current template
- Browser Print / Save as PDF workflow
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

Vite will print a local URL, normally:

```text
http://localhost:5173
```

### Production build

```bash
npm run typecheck
npm run build
npm run preview
```

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

## Current MVP limitations

The current project proves the editor/data-binding architecture but is not yet a production replacement for Canva. Important next items include:

- Persist templates/reports to a backend/database
- Real authentication and permissions
- Undo/redo history stack
- Multi-select / snapping / alignment guides
- Rich-text editing
- Image uploads and asset storage
- Production chart library or richer SVG chart engine
- Repeating components and repeating pages
- Conditional visibility / conditional formatting UI
- Server-side deterministic PDF rendering
- Template versioning and immutable published versions
- Report instance snapshots
- Data provenance and manual-override tracking
- Ascendix/Salesforce integration
- Full reconstruction of the current Industrial Market Report template
- Page-level export of an entire multipage report rather than only the current browser print view

## Recommended next milestone

Do not add broad design features yet. The strongest next milestone is:

1. Recreate the current Industrial Market Report template with pixel-level fidelity.
2. Formalize the normalized Industrial Market Report data schema.
3. Wire the existing Overall Market Table payload into the data-provider layer.
4. Add repeat-page generation for selected submarkets.
5. Add a production PDF renderer.
6. Compare generated output side-by-side with the existing Canva report.

That will determine whether the architecture can truly replace the production workflow before time is spent on secondary editor features.
