import { selectQuery, soqlLiteral } from "../salesforce/soql.ts";
import { salesforceFieldMap as mapping } from "./salesforceFieldMap.ts";
import { normalizeQuarterBounds } from "./salesforceNormalization.ts";

const api = (entry: { apiName: string }) => entry.apiName;
const relatedPropertyFields = [
  "ascendix__Property__r.Full_Address__c",
  "ascendix__Property__r.Submarket_Picklist__c",
  "ascendix__Property__r.Property_Type__c",
  "ascendix__Property__r.ascendix__PropertySubType__c",
  "ascendix__Property__r.ascendix__PrimaryImage__c",
];

export function historicalLeaseQuery(period: string, submarket?: string) {
  const bounds = normalizeQuarterBounds(period);
  const lease = mapping.lease;
  const filters = [
    `${api(lease.offMarketDate)} >= ${bounds.start}`,
    `${api(lease.offMarketDate)} <= ${bounds.end}`,
  ];
  if (submarket)
    filters.push(
      `ascendix__Property__r.Submarket_Picklist__c = ${soqlLiteral(submarket, "submarket")}`,
    );
  return selectQuery(
    api(lease.object),
    [
      "Id",
      api(lease.propertyId),
      api(lease.sizeSf),
      api(lease.offMarketDate),
      api(lease.tenant),
      api(lease.type),
      api(lease.subtype),
      ...relatedPropertyFields,
    ],
    filters.join(" AND "),
    ` ORDER BY ${api(lease.sizeSf)} DESC LIMIT 20`,
  );
}

export function historicalSaleQuery(
  period: string,
  submarket?: string,
  useFallbackDate = false,
) {
  const bounds = normalizeQuarterBounds(period);
  const sale = mapping.sale;
  const date = useFallbackDate ? sale.offMarketDate : sale.saleDate;
  const filters = [
    `${api(date)} >= ${bounds.start}`,
    `${api(date)} <= ${bounds.end}`,
  ];
  if (submarket)
    filters.push(
      `ascendix__Property__r.Submarket_Picklist__c = ${soqlLiteral(submarket, "submarket")}`,
    );
  return selectQuery(
    api(sale.object),
    [
      "Id",
      api(sale.propertyId),
      api(sale.buildingSf),
      api(sale.saleDate),
      api(sale.offMarketDate),
      api(sale.price),
      api(sale.type),
      api(sale.normalizedBuyer),
      ...relatedPropertyFields,
    ],
    filters.join(" AND "),
    ` ORDER BY ${api(sale.price)} DESC LIMIT 20`,
  );
}
