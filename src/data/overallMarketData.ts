import { q2Availabilities, q2Construction, q2Deliveries, q2HistoricalPeriods, q2Leases, q2Sales, q2SampleReport, q2Submarkets } from '../data-providers/sample/q2SampleReport';
import { buildPresentationModel } from '../report-engine/bindings/presentationModel';

/** Backward-compatible editor view of the normalized Q2 report. */
export const overallMarketData = buildPresentationModel(q2SampleReport);
export const normalizedOverallMarketReport = q2SampleReport;
export const submarkets = q2Submarkets;
export const periods = q2HistoricalPeriods;
export const topLeases = q2Leases;
export const topSales = q2Sales;
export const topAvailabilities = q2Availabilities;
export const topDeliveries = q2Deliveries;
export const topConstruction = q2Construction;
export const submarketTableRows = overallMarketData.submarketTableRows;
export const sourceNotes = q2SampleReport.provenance;

