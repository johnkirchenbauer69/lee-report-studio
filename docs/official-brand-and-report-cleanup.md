# Official Lee identity and safe legacy report cleanup

Application chrome uses the supplied 2021 Lee brand guide: Lee Red `#98002E`, Slate `#7E8083`, White `#FFFFFF`; secondary Charcoal `#303C42`, Navy `#003146`, Sky `#009AD9`, Frost `#A9C3CB`; accents Merlot `#4E131E`, Bright Red `#CD1442`, Green `#8A941E`, Mint `#6FC9C4`. The optional gradient is Bright Red -> Lee Red -> Merlot at 145 degrees.

The supplied full-color logo appears on Home and the Windows launch page. The official compact icon appears in navigation, the browser favicon, and the Windows shortcut. Original PNG bytes, alpha, and aspect ratios are preserved. ICO frames contain the original icon on a transparent square without stretching or recoloring.

Application typography loads already approved, licensed Avenir Next LT Pro assets into a private application-only font family. Arial is the brand-guide fallback. No proprietary font binaries are checked in. Report-page typography, indicator semantics, calculations, source data, and export layout are independent of these UI styles.

## Cleanup procedure and recovery protection

`scripts/cleanup-legacy-reports.mjs` requires an explicit retained ID and SHA256 and refuses to run while the application API port is listening. The retained report must be the unique published Q3 2026 v1.20.0 edition. Backups contain every report, template manifest, shared asset, report asset, and asset manifest. Each backup checksum is verified before deletion. A manifest inventories cross-record references and every deleted ID. Files are revalidated immediately before mutation and read back afterward.

Cleanup deletes only explicitly inventoried report JSON files. It reclaims no shared assets. A durable deletion ledger prevents deleted IDs from being recreated by repository saves. Client startup removes only recovery entries associated with these conclusively deleted IDs; other recovery data and preferences remain intact.

## UX behavior

Home and Reports show compact report cards with prominent reporting periods, clear status, consistent actions, filters, and expandable details. The editor distinguishes quarterly report status from source template status. Template save/publication actions are available in master-template mode. Published reports remain immutable and reopen their saved snapshot; review and supported Chromium export remain available.

Application navigation, document actions, editing toolbar, inspector disclosures, asset workspace, dialogs, and launcher share corporate tokens, consistent control sizing, and visible keyboard focus. Existing document controls and report canvas rendering remain in use.

## Validation and data isolation

The existing visual suite checks an isolated test API and exact per-run storage identity before creating fixtures or performing mutations. Test fixture setup creates required legacy template versions and a published sample, and imports redistributable official logo images for replacement tests. Optional `PLAYWRIGHT_FONT_FIXTURE_ROOT` copies only checksum-verified approved licensed fonts from a read-only local source into disposable test storage. Production reports and template files are never imported into test storage.

Visual assertions, image comparison tolerances, and existing acceptance coverage remain unchanged. Legacy control locators now navigate the actual document header, view options, and inspector disclosures. Local logs, before/after screenshots at four desktop resolutions, backup inventory, and retained-report export evidence are under the ignored `output/brand-cleanup/` directory.
