import type { MarketMetrics, SubmarketMetrics } from '../schema/industrialMarketReport';

const sum = (items: SubmarketMetrics[], key: keyof MarketMetrics) => items.reduce((total, item) => total + item[key], 0);

function weightedAverage(items: SubmarketMetrics[], value: keyof MarketMetrics, weight: keyof MarketMetrics): number {
  const denominator = sum(items, weight);
  if (denominator === 0) return 0;
  return items.reduce((total, item) => total + item[value] * item[weight], 0) / denominator;
}

export function calculateMarketTotals(submarkets: SubmarketMetrics[]): MarketMetrics {
  if (!submarkets.length) return { inventorySf: 0, deliveredSf: 0, underConstructionSf: 0, speculativeShare: 0, netAbsorptionSf: 0, vacancyRate: 0, availabilityRate: 0, askingNetRentPsf: 0, salesVolume: 0 };
  return {
    inventorySf: sum(submarkets, 'inventorySf'),
    deliveredSf: sum(submarkets, 'deliveredSf'),
    underConstructionSf: sum(submarkets, 'underConstructionSf'),
    speculativeShare: weightedAverage(submarkets, 'speculativeShare', 'underConstructionSf'),
    netAbsorptionSf: sum(submarkets, 'netAbsorptionSf'),
    vacancyRate: weightedAverage(submarkets, 'vacancyRate', 'inventorySf'),
    availabilityRate: weightedAverage(submarkets, 'availabilityRate', 'inventorySf'),
    askingNetRentPsf: weightedAverage(submarkets, 'askingNetRentPsf', 'inventorySf'),
    salesVolume: sum(submarkets, 'salesVolume'),
  };
}

export function calculateMetricExtremes(submarkets: SubmarketMetrics[], key: keyof MarketMetrics): { minimum?: SubmarketMetrics; maximum?: SubmarketMetrics } {
  if (!submarkets.length) return {};
  return submarkets.slice(1).reduce((result, item) => ({
    minimum: item[key] < result.minimum![key] ? item : result.minimum,
    maximum: item[key] > result.maximum![key] ? item : result.maximum,
  }), { minimum: submarkets[0], maximum: submarkets[0] } as { minimum: SubmarketMetrics; maximum: SubmarketMetrics });
}

export function calculateWeightedVacancy(submarkets: SubmarketMetrics[]): number {
  return weightedAverage(submarkets, 'vacancyRate', 'inventorySf');
}

