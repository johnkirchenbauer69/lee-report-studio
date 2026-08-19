import { describe,expect,it } from 'vitest';
import { q2SampleReport } from '../../data-providers/sample/q2SampleReport';
import { findProvenance, resolvePresentationValue } from './provenance';

describe('provenance and approved overrides',()=>{
  it('retains the normalized value while resolving the approved visible value',()=>{const market=q2SampleReport.submarkets.find(item=>item.name==='Southeast Wisconsin')!;expect(market.netAbsorptionSf).toBe(891612);expect(resolvePresentationValue(q2SampleReport,'submarkets.Southeast Wisconsin.netAbsorptionSf',market.netAbsorptionSf)).toBe(891615);});
  it('exposes source authority and reconciliation state',()=>expect(findProvenance(q2SampleReport,'overallMarket.vacancyRate')).toMatchObject({status:'reconciled',authority:'Calculated submarket workbook total'}));
});

