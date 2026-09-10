import "dotenv/config";

import {
  contributorSection,
  selectContributorFinalists,
} from "../server/integrations/ascendix/contributors.ts";
import { CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS } from "../server/integrations/ascendix/salesforceFieldMap.ts";
import { loadSalesforceConfig } from "../server/integrations/salesforce/config.ts";
import { SalesforceRestClient } from "../server/integrations/salesforce/SalesforceClient.ts";
import {
  soqlLiteral,
  soqlLiteralList,
} from "../server/integrations/salesforce/soql.ts";
import type { IndustrialMarketReport } from "../src/report-engine/schema/industrialMarketReport.ts";
import { resolveApiBaseUrl } from "../src/shared/apiBaseUrl.ts";

const periods = process.argv.slice(2);
if (!periods.length) periods.push("2026 Q2", "2026 Q3");

const client = new SalesforceRestClient(loadSalesforceConfig());
const api = resolveApiBaseUrl({ environment: process.env });
const highlightSections = new Set([
  "availabilities",
  "deliveries",
  "construction",
]);
const examples = new Set([
  "Central DuPage",
  "Chicago South",
  "I-55 Corridor",
  "O'Hare",
]);

const countBy = (values: string[]) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [
        value,
        values.filter((candidate) => candidate === value).length,
      ]),
  );

for (const period of periods) {
  const rows = await client.query(
    `SELECT Id, Quarter_Label__c, Submarket__c, Contributor_Category__c, Rank__c, Sort_Value__c, Metric_Value__c, Active_In_Run__c, Included_In_Report__c, Source_Object__c, Source_Record_ID__c, Property__c, Availability__c, Address__c FROM Market_Data_Contributor__c WHERE Quarter_Label__c = ${soqlLiteral(period, "period")} AND Active_In_Run__c = TRUE AND Included_In_Report__c = TRUE`,
  );
  const scopes = [
    { name: "Overall Market", rows },
    ...CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS.map((name) => ({
      name,
      rows: rows.filter((row) => row.Submarket__c === name),
    })),
  ];
  const cardRows = scopes.flatMap((scope) =>
    selectContributorFinalists(scope.rows)
      .filter((row) =>
        highlightSections.has(
          contributorSection(row.Contributor_Category__c) ?? "",
        ),
      )
      .map((row) => ({ scope: scope.name, row })),
  );
  const propertyIds = [
    ...new Set(
      cardRows
        .map(({ row }) => String(row.Property__c ?? "").trim())
        .filter(Boolean),
    ),
  ];
  const properties = propertyIds.length
    ? await client.query(
        `SELECT Id, ascendix__PrimaryImage__c FROM ascendix__Property__c WHERE Id IN ${soqlLiteralList(propertyIds, "property ids")}`,
      )
    : [];
  const propertiesById = new Map(
    properties.map((property) => [property.Id, property]),
  );
  const linkRoutes = cardRows.map(({ row }) =>
    row.Property__c
      ? "direct Property__c"
      : row.Availability__c
        ? "Availability__c relationship"
        : row.Source_Object__c === "Property_Data__c"
          ? "Property_Data__c source only"
          : "no safe property route",
  );
  const sourceImages = cardRows.map(({ row }) => {
    const property = propertiesById.get(String(row.Property__c ?? ""));
    return String(property?.ascendix__PrimaryImage__c ?? "").trim();
  });
  const auditedCardRows = cardRows.map((entry, index) => ({
    ...entry,
    linkRoute: linkRoutes[index]!,
    sourceImage: sourceImages[index]!,
  }));

  const reportResponse = await fetch(
    `${api}/api/report-data/industrial-market`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reportType: "industrial-market-report",
        market: "Chicago",
        period,
        calculationScope: { type: "all-submarkets" },
        timeContext: { type: "historical-period", period },
      }),
    },
  );
  if (!reportResponse.ok)
    throw new Error(
      `Report Data request failed for ${period}: ${reportResponse.status}`,
    );
  const payload = (await reportResponse.json()) as {
    report: IndustrialMarketReport;
    sourceMetadata: { diagnostics?: string[] };
  };
  const reportScopes = [payload.report, ...payload.report.submarketDetails];
  const reportCards = reportScopes.flatMap((scope) => [
    ...scope.availabilities,
    ...scope.deliveries,
    ...scope.construction,
  ]);
  const resolved = reportCards.filter((card) =>
    card.image.startsWith("/api/assets/"),
  ).length;
  const noSafePropertyRoute = linkRoutes.filter(
    (route) => route === "no safe property route",
  ).length;
  const noPrimaryImage = sourceImages.filter((image) => !image).length;
  const resolutionFailed = Math.max(
    0,
    reportCards.length - resolved - noSafePropertyRoute - noPrimaryImage,
  );

  console.log(
    JSON.stringify(
      {
        period,
        totalContributorImageSlots: scopes.length * 9,
        populatedContributorCards: reportCards.length,
        resolvedStudioAssets: resolved,
        unavailable: {
          noRankedContributor: scopes.length * 9 - reportCards.length,
          noSafePropertyRoute,
          noPrimaryImage,
          resolutionFailed,
        },
        linkRoutes: countBy(linkRoutes),
        sourcePrimaryImages: {
          present: sourceImages.filter(Boolean).length,
          absent: noPrimaryImage,
        },
        examples: auditedCardRows
          .filter(({ scope }) => examples.has(scope))
          .map(({ scope, row, linkRoute, sourceImage }) => ({
            scope,
            section: contributorSection(row.Contributor_Category__c),
            rank: row.Rank__c,
            address: row.Address__c,
            linkRoute,
            hasPrimaryImage: Boolean(sourceImage),
          })),
        imageDiagnostics: (payload.sourceMetadata.diagnostics ?? []).filter(
          (diagnostic) => /image|attachment/i.test(diagnostic),
        ),
      },
      null,
      2,
    ),
  );
}
