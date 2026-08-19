# Q2 2026 Overall Market Reference

## Source hierarchy

1. `Submarket Stats - Data Table.xlsx` is authoritative for typed submarket inputs and auditable market-total calculations.
2. `2026 Q2 - Overall Market Report.pdf` is authoritative for approved visible copy, presentation values, geometry, colors, and page composition.
3. `overall-market.zip` supplies original chart exports, property photography, the market-indicator/top-record workbook, and narrative draft.

## Implemented pages

- Cover: Chicago skyline, report title, quarter treatment, office identity and contact line.
- Overall Market Table: 18 submarkets, market totals, minimums and maximums across ten columns.
- Market Overview: approved narrative, map, five-quarter indicators, two charts, top leases and top sales.
- Market Highlights: two charts and three photographic cards each for availability, deliveries and construction.

## Reconciliation policy

Raw numeric fields retain workbook values. Where the approved PDF intentionally or accidentally differs, the presentation layer may retain the approved visible value while `sourceNotes` records both values and the chosen authority.

Known Q2 differences:

- Overall vacancy: approved PDF `4.96%`; indicator workbook `4.84%`.
- Overall availability: approved PDF `8.53%`; indicator workbook `8.46%`.
- Under construction: approved submarket total `13,912,547 SF`; indicator workbook `13,779,195 SF`.
- Construction speculative: approved market total `34%`; calculation from rounded visible submarket shares rounds to `35%`. The normalized calculation remains available while the approved aggregate is an explicit presentation override.
- Southeast Wisconsin absorption: workbook `891,612 SF`; approved PDF row `891,615 SF`. The market total reconciles to the workbook value.

## Geometry

All four pages are US Letter portrait (`816 x 1056` CSS reference pixels, equivalent to `612 x 792` PDF points). Editor geometry remains in CSS pixels at `96px = 1in`.

## Visual authority

The approved PDF pages are checked into `tests/visual/baselines`. Baseline changes require intentional review through `npm run test:visual:update`; normal tests never rewrite them.
