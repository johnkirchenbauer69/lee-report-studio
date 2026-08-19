import { describe, expect, it } from 'vitest';
import { overallMarketData, sourceNotes, submarketTableRows, submarkets } from './overallMarketData';
import { sampleTemplate } from './sampleTemplate';
import { validatePage } from '../engine/validation';

describe('normalized overall-market data',()=>{
  it('reconciles additive submarket totals to the approved report',()=>{
    expect(submarkets.reduce((sum,item)=>sum+item.inventorySf,0)).toBe(1_257_981_203);
    expect(submarkets.reduce((sum,item)=>sum+item.deliveredSf,0)).toBe(1_651_772);
    expect(submarkets.reduce((sum,item)=>sum+item.underConstructionSf,0)).toBe(13_912_547);
    expect(submarkets.reduce((sum,item)=>sum+item.netAbsorptionSf,0)).toBe(5_206_811);
  });

  it('uses inventory-weighted vacancy and availability totals',()=>{
    const inventory=submarkets.reduce((sum,item)=>sum+item.inventorySf,0);
    const vacancy=submarkets.reduce((sum,item)=>sum+item.vacancyRate*item.inventorySf,0)/inventory;
    const availability=submarkets.reduce((sum,item)=>sum+item.availabilityRate*item.inventorySf,0)/inventory;
    expect(vacancy).toBeCloseTo(overallMarketData.overallMarket.vacancyRate,10);
    expect(availability).toBeCloseTo(overallMarketData.overallMarket.availabilityRate,10);
  });

  it('preserves approved-versus-alternate source discrepancies',()=>{
    expect(sourceNotes).toContainEqual(expect.objectContaining({fieldPath:'overallMarket.vacancyRate',status:'reconciled'}));
    expect(sourceNotes.find(note=>note.fieldPath==='overallMarket.vacancyRate')?.sources).toContainEqual(expect.objectContaining({value:.0484}));
    expect(sourceNotes).toContainEqual(expect.objectContaining({fieldPath:'overallMarket.availabilityRate',status:'reconciled'}));
  });

  it('builds detail, total, minimum and maximum presentation rows',()=>{
    expect(submarketTableRows).toHaveLength(21);
    expect(submarketTableRows.slice(-3).map(row=>row.kind)).toEqual(['total','minimum','maximum']);
  });

  it('keeps every production page inside its letter-size canvas',()=>{
    const errors=sampleTemplate.pages.flatMap(page=>validatePage(page,overallMarketData)).filter(issue=>issue.level==='error');
    expect(errors).toEqual([]);
  });
});
