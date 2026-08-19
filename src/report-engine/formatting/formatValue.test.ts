import { describe,expect,it } from 'vitest';
import { formatReportValue } from './formatValue';

describe('report formatting',()=>{
  it('keeps normalized percentages numeric until presentation',()=>expect(formatReportValue(.0496057,{type:'percentage',decimals:2})).toBe('4.96%'));
  it('formats square feet and currency consistently',()=>{expect(formatReportValue(13912547,{type:'square-feet',suffix:false})).toBe('13,912,547');expect(formatReportValue(1236100000,{type:'currency',decimals:0})).toBe('$1,236,100,000');});
  it('uses deliberate rounding rules',()=>expect(formatReportValue(8.4277,{type:'currency-per-square-foot',decimals:2})).toBe('$8.43/SF'));
});

