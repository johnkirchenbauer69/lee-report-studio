import { describe, expect, it } from 'vitest';
import { distribute, fillToCss, fromPixels, snapPosition, toPixels } from './editorMath';
import { formatValue, getByPath } from './bindings';
import { validatePage } from './validation';
import type { ReportElement, ReportPage } from '../types/report';

const shape = (id:string,x:number,y:number,width=100,height=50):ReportElement => ({id,type:'shape',name:id,x,y,width,height,shape:'rectangle',style:{}});

describe('unit conversion', () => {
  it('uses the documented 96px CSS inch', () => { expect(toPixels(1,'in')).toBe(96); expect(fromPixels(192,'in')).toBe(2); expect(toPixels(25,'px')).toBe(25); });
});

describe('binding and formatting', () => {
  it('resolves nested paths and array positions', () => expect(getByPath({markets:[{vacancy:.052}]},'markets[0].vacancy')).toBe(.052));
  it('formats report metrics', () => { expect(formatValue(.052,{path:'x',format:'percentage',decimals:1})).toBe('5.2%'); expect(formatValue(1250000,{path:'x',format:'sf',decimals:1})).toBe('1.3M SF'); });
});

describe('editor math', () => {
  it('snaps to page center and returns a visible guide', () => { const result=snapPosition({x:352,y:100,width:100,height:50,pageWidth:816,pageHeight:1056,others:[],snapElements:true}); expect(result.x).toBe(358); expect(result.guides).toContainEqual({axis:'x',position:408}); });
  it('snaps to the configured grid', () => expect(snapPosition({x:26,y:51,width:10,height:10,pageWidth:100,pageHeight:100,others:[],snapGrid:true,gridSpacing:24}).x).toBe(24));
  it('distributes three elements with equal spacing', () => { const result=distribute([shape('a',0,0),shape('b',130,0),shape('c',300,0)],'x'); expect(result.get('b')).toBe(150); });
  it('renders two and three stop gradients', () => { const css=fillToCss({type:'linear-gradient',angle:90,stops:[{id:'a',color:'#000000',position:0},{id:'b',color:'#777777',position:50},{id:'c',color:'#ffffff',position:100}]}); expect(css).toContain('linear-gradient(90deg'); expect(css).toContain('#777777 50%'); });
});

describe('validation', () => {
  it('reports invalid geometry, missing bindings, and invalid gradients', () => { const page:ReportPage={id:'p',name:'Page',width:816,height:1056,background:'#fff',elements:[{...shape('bad',800,10,0,20),binding:{path:'missing'},style:{fill:{type:'linear-gradient',angle:0,stops:[]}}}]}; const issues=validatePage(page,{}); expect(issues.some(item=>item.level==='error')).toBe(true); expect(issues.some(item=>item.message.includes('Missing data'))).toBe(true); });
});
