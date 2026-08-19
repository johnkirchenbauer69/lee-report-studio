# Build Roadmap

## Phase 0 — Current prototype

Status: included in this repository.

- Visual editor shell
- Multi-page document schema
- Drag / resize
- Basic elements
- Data preview
- Semantic binding paths
- Formatting engine
- Dynamic tables
- Dynamic chart
- Validation
- Template JSON export
- Print/PDF proof of concept

## Phase 1 — Production document core

- Move editor state to reducer/store architecture
- Command-pattern undo/redo
- Multi-select
- keyboard delete/duplicate/nudge
- layer reordering
- snapping and smart guides
- alignment/distribution
- page reorder via drag/drop
- safe autosave
- explicit template schema version/migrations
- text overflow detection
- asset model

Acceptance test: editing feels reliable enough for a designer to work for an hour without corrupting a document.

## Phase 2 — Exact Industrial Market Report recreation

- Measure the current report's page size/grid
- Recreate brand typography, headers, footers and page components
- Build Overall Market table
- Build overview charts
- Build submarket overview/activity page components
- Add disclosures and static content

Acceptance test: static test data produces a report visually comparable to the existing production report.

## Phase 3 — Ascendix integration

- Define `IndustrialMarketReportData` TypeScript interface
- Create server-side data-provider abstraction
- Add mock provider
- Add Ascendix provider
- Integrate existing Overall Market Table payload
- Add normalization and contract validation
- Add source/provenance metadata

Acceptance test: a quarter/market selection generates page 2 with no manually keyed statistics.

## Phase 4 — Dynamic generation

- Repeating component schema
- Repeat transaction cards
- Repeating page/page-group schema
- Generate selected submarket pages automatically
- Conditional visibility
- Conditional formatting
- report-generation wizard

Acceptance test: user chooses report period + submarkets and receives a complete editable first draft.

## Phase 5 — Persistence/versioning

- Database
- Authentication
- Template draft/published lifecycle
- Immutable published versions
- Report instance persistence
- Report source-data snapshots
- Manual override tracking
- Revision history

## Phase 6 — Production export and QA

- Server-side PDF generation
- Font embedding strategy
- image resolution checks
- preflight validation
- overflow detection
- full-report export
- page PNG exports
- approval workflow

Acceptance test: PDFs are suitable for external distribution and stable across browsers/machines.

## Phase 7 — Expansion

- Property flyer template
- Comp report template
- BOV template
- Offering memorandum components
- Maps
- AI-assisted market narratives with human approval
- component library
- broader report schema registry
