export interface SubmarketMetric {
  name: string;
  inventorySf: number;
  deliveredSf: number;
  underConstructionSf: number;
  speculativeShare: number;
  netAbsorptionSf: number;
  vacancyRate: number;
  availabilityRate: number;
  askingNetRentPsf: number;
  salesVolume: number;
}

export interface PeriodMetric {
  period: string;
  netAbsorption12MonthSf: number;
  vacancyRate: number;
  availabilityRate: number;
  underConstructionSf: number;
  leasingActivitySf: number;
}

export interface TransactionRecord {
  party: string;
  amount: number;
  address: string;
  type: string;
}

export interface PropertyHighlight {
  address: string;
  sizeSf: number;
  type: string;
  sponsor: string;
  image: string;
}

export interface SourceNote {
  field: string;
  approvedValue: number;
  alternateValue?: number;
  authority: string;
  note: string;
}
