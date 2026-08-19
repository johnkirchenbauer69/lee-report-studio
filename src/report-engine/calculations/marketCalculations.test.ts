import { describe,expect,it } from 'vitest';
import type { SubmarketMetrics } from '../schema/industrialMarketReport';
import { calculateMarketTotals, calculateMetricExtremes, calculateWeightedVacancy } from './marketCalculations';

const market=(name:string,inventorySf:number,vacancyRate:number,netAbsorptionSf=0):SubmarketMetrics=>({name,inventorySf,vacancyRate,netAbsorptionSf,deliveredSf:0,underConstructionSf:0,speculativeShare:0,availabilityRate:vacancyRate,askingNetRentPsf:10,salesVolume:0});

describe('market calculations',()=>{
  it('calculates additive totals and weighted rates',()=>{const result=calculateMarketTotals([market('A',100,.1,20),market('B',300,.2,-5)]);expect(result.inventorySf).toBe(400);expect(result.netAbsorptionSf).toBe(15);expect(result.vacancyRate).toBeCloseTo(.175);});
  it('handles empty and zero-inventory markets',()=>{expect(calculateWeightedVacancy([])).toBe(0);expect(calculateWeightedVacancy([market('A',0,.5)])).toBe(0);});
  it('preserves negative absorption and finds ties deterministically',()=>{const rows=[market('First',100,.1,-10),market('Second',100,.2,-10)];expect(calculateMarketTotals(rows).netAbsorptionSf).toBe(-20);expect(calculateMetricExtremes(rows,'netAbsorptionSf').minimum?.name).toBe('First');});
  it('finds minimum and maximum values',()=>{const result=calculateMetricExtremes([market('Low',100,.01),market('High',100,.2)],'vacancyRate');expect(result.minimum?.name).toBe('Low');expect(result.maximum?.name).toBe('High');});
});

