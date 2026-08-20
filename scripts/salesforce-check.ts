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
  const required = [
    mapping.marketData.period,
    mapping.marketData.inventorySf,
    mapping.marketData.vacancyRate,
    mapping.marketData.availabilityRate,
    mapping.marketData.netAbsorptionSf,
    mapping.marketData.askingNetRentPsf,
    mapping.marketData.salesVolume,
  ];
  console.log("\nMarket_Data__c field capability");
  for (const field of required) {
    try {
      await client.query(
        `SELECT Id, ${field.apiName} FROM ${mapping.marketData.object.apiName} WHERE Id != NULL LIMIT 1`,
      );
      console.log(`✓ ${field.apiName}`);
    } catch {
      console.log(`⚠ ${field.apiName} unavailable`);
      process.exitCode = 1;
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
}
