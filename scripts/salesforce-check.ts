import "dotenv/config";
import {
  contributorOptionalRelationshipFields,
  salesforceFieldMap as mapping,
} from "../server/integrations/ascendix/salesforceFieldMap.ts";
import { SalesforceRestClient } from "../server/integrations/salesforce/SalesforceClient.ts";
import { loadSalesforceConfig } from "../server/integrations/salesforce/config.ts";

const config = loadSalesforceConfig();
const client = new SalesforceRestClient(config);
const health = await client.health();
const hostname = health.instanceUrl
  ? new URL(health.instanceUrl).hostname
  : undefined;
console.log(
  `Configured: yes\nConnected: ${health.connected ? "yes" : "no"}\nAuth mode: ${config.authStrategy.mode}\nInstance: ${hostname ?? "unavailable"}\nAPI version: ${config.apiVersion}`,
);
if (!health.connected) process.exitCode = 1;
else {
  const objects = [
    mapping.marketData.object.apiName,
    mapping.contributor.object.apiName,
    mapping.lease.object.apiName,
    mapping.sale.object.apiName,
    mapping.availability.object.apiName,
    mapping.property.object.apiName,
    mapping.propertyData.object.apiName,
  ];
  for (const object of objects) {
    try {
      await client.query(`SELECT Id FROM ${object} WHERE Id != NULL LIMIT 1`);
      console.log(`✓ ${object} accessible`);
    } catch {
      console.log(`⚠ ${object} unavailable`);
      process.exitCode = 1;
    }
  }
  const requiredGroups = [
    {
      object: mapping.marketData.object.apiName,
      fields: [
        mapping.marketData.period,
        mapping.marketData.submarket,
        mapping.marketData.inventorySf,
        mapping.marketData.totalVacantSf,
        mapping.marketData.vacancyRate,
        mapping.marketData.totalAvailableSf,
        mapping.marketData.availabilityRate,
        mapping.marketData.quarterlyNetAbsorptionSf,
        mapping.marketData.askingNetRentPsf,
        mapping.marketData.salesVolume,
      ],
    },
    {
      object: mapping.propertyData.object.apiName,
      fields: [
        mapping.propertyData.quarter,
        mapping.propertyData.scope,
        mapping.propertyData.submarket,
        mapping.propertyData.marketDataId,
        mapping.propertyData.inventorySf,
        mapping.propertyData.vacantSf,
        mapping.propertyData.availableSf,
        mapping.propertyData.quarterlyNetAbsorptionSf,
        mapping.propertyData.leasingActivitySf,
        mapping.propertyData.deliveredSf,
        mapping.propertyData.underConstructionSf,
        mapping.propertyData.underConstructionAvailableSf,
      ],
    },
    {
      object: mapping.contributor.object.apiName,
      fields: [
        mapping.contributor.period,
        mapping.contributor.submarket,
        mapping.contributor.marketDataId,
        mapping.contributor.category,
        mapping.contributor.sortValue,
        mapping.contributor.rank,
        mapping.contributor.active,
        mapping.contributor.included,
      ],
    },
  ];
  for (const group of requiredGroups) {
    console.log(`\n${group.object} field capability`);
    for (const field of group.fields) {
      try {
        await client.query(
          `SELECT Id, ${field.apiName} FROM ${group.object} WHERE Id != NULL LIMIT 1`,
        );
        console.log(`✓ ${field.apiName}`);
      } catch {
        console.log(`⚠ ${field.apiName} unavailable`);
        process.exitCode = 1;
      }
    }
  }
  console.log("\nOptional contributor relationship capability");
  for (const field of contributorOptionalRelationshipFields) {
    try {
      await client.query(
        `SELECT Id, ${field} FROM ${mapping.contributor.object.apiName} WHERE Id != NULL LIMIT 1`,
      );
      console.log(`✓ ${field} queryable`);
    } catch {
      console.log(`⚠ ${field} unavailable`);
    }
  }
  console.log(
    `\nCapability-check Salesforce API calls: ${client.getApiCallCount()}`,
  );
}
