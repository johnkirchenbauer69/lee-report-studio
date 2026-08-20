export interface FieldMapping {
  apiName: string;
  verified: boolean;
}

const field = (environmentName: string, placeholder: string): FieldMapping => ({
  apiName: process.env[environmentName] ?? placeholder,
  verified: Boolean(process.env[environmentName]),
});

export const salesforceFieldMap = {
  marketData: {
    object: field("SF_OBJECT_MARKET_DATA", "Market_Data__c"),
    market: field("SF_FIELD_MARKET", "Market__c"),
    period: field("SF_FIELD_PERIOD", "Period__c"),
    submarket: field("SF_FIELD_SUBMARKET", "Submarket__c"),
    inventorySf: field("SF_FIELD_INVENTORY_SF", "Inventory_SF__c"),
    deliveredSf: field("SF_FIELD_DELIVERED_SF", "Delivered_SF__c"),
    underConstructionSf: field(
      "SF_FIELD_UNDER_CONSTRUCTION_SF",
      "Under_Construction_SF__c",
    ),
    speculativeShare: field(
      "SF_FIELD_SPECULATIVE_SHARE",
      "Speculative_Share__c",
    ),
    netAbsorptionSf: field(
      "SF_FIELD_NET_ABSORPTION_SF",
      "Net_Absorption_SF__c",
    ),
    vacancyRate: field("SF_FIELD_VACANCY_RATE", "Vacancy_Rate__c"),
    availabilityRate: field(
      "SF_FIELD_AVAILABILITY_RATE",
      "Availability_Rate__c",
    ),
    askingNetRentPsf: field("SF_FIELD_ASKING_RENT", "Asking_Net_Rent_PSF__c"),
    salesVolume: field("SF_FIELD_SALES_VOLUME", "Sales_Volume__c"),
    leasingActivitySf: field(
      "SF_FIELD_LEASING_ACTIVITY_SF",
      "Leasing_Activity_SF__c",
    ),
    narrative: field("SF_FIELD_MARKET_NARRATIVE", "Narrative__c"),
  },
  lease: {
    object: field("SF_OBJECT_LEASE", "Lease__c"),
    market: field("SF_LEASE_FIELD_MARKET", "Market__c"),
    period: field("SF_LEASE_FIELD_PERIOD", "Report_Period__c"),
    tenant: field("SF_LEASE_FIELD_TENANT", "Tenant_Name__c"),
    sizeSf: field("SF_LEASE_FIELD_SIZE", "Size_SF__c"),
    address: field("SF_LEASE_FIELD_ADDRESS", "Property_Address__c"),
    type: field("SF_LEASE_FIELD_TYPE", "Lease_Type__c"),
  },
  sale: {
    object: field("SF_OBJECT_PROPERTY_DATA", "Property_Data__c"),
    market: field("SF_SALE_FIELD_MARKET", "Market__c"),
    period: field("SF_SALE_FIELD_PERIOD", "Report_Period__c"),
    buyer: field("SF_SALE_FIELD_BUYER", "Buyer__c"),
    price: field("SF_SALE_FIELD_PRICE", "Sale_Price__c"),
    address: field("SF_SALE_FIELD_ADDRESS", "Property_Address__c"),
    type: field("SF_SALE_FIELD_TYPE", "Sale_Type__c"),
  },
  availability: {
    object: field("SF_OBJECT_AVAILABILITY", "Availability__c"),
    market: field("SF_AVAILABILITY_FIELD_MARKET", "Market__c"),
    period: field("SF_AVAILABILITY_FIELD_PERIOD", "Report_Period__c"),
    address: field("SF_AVAILABILITY_FIELD_ADDRESS", "Property_Address__c"),
    sizeSf: field("SF_AVAILABILITY_FIELD_SIZE", "Available_SF__c"),
    type: field("SF_AVAILABILITY_FIELD_TYPE", "Availability_Type__c"),
    sponsor: field("SF_AVAILABILITY_FIELD_SPONSOR", "Sponsor__c"),
    image: field("SF_AVAILABILITY_FIELD_IMAGE", "Image_URL__c"),
  },
  construction: {
    object: field("SF_OBJECT_CONSTRUCTION", "Construction_Pipeline__c"),
    market: field("SF_CONSTRUCTION_FIELD_MARKET", "Market__c"),
    period: field("SF_CONSTRUCTION_FIELD_PERIOD", "Report_Period__c"),
    address: field("SF_CONSTRUCTION_FIELD_ADDRESS", "Property_Address__c"),
    sizeSf: field("SF_CONSTRUCTION_FIELD_SIZE", "Building_SF__c"),
    type: field("SF_CONSTRUCTION_FIELD_TYPE", "Project_Type__c"),
    sponsor: field("SF_CONSTRUCTION_FIELD_SPONSOR", "Sponsor__c"),
    image: field("SF_CONSTRUCTION_FIELD_IMAGE", "Image_URL__c"),
    status: field("SF_CONSTRUCTION_FIELD_STATUS", "Pipeline_Status__c"),
  },
  contributor: {
    object: field("SF_OBJECT_MARKET_CONTRIBUTOR", "Market_Data_Contributor__c"),
    marketDataId: field("SF_CONTRIBUTOR_FIELD_MARKET_DATA", "Market_Data__c"),
    contributionType: field(
      "SF_CONTRIBUTOR_FIELD_TYPE",
      "Contribution_Type__c",
    ),
    value: field("SF_CONTRIBUTOR_FIELD_VALUE", "Value__c"),
  },
} as const;

export const unverifiedSalesforceMappings = () =>
  Object.entries(salesforceFieldMap).flatMap(([group, mappings]) =>
    Object.entries(mappings)
      .filter(([, mapping]) => !mapping.verified)
      .map(([name]) => `${group}.${name}`),
  );
