import { describe,expect,it } from 'vitest';
import type { ReportTemplate } from '../../types/report';
import { expandTemplatePages } from './repeaters';

const template:ReportTemplate={id:'t',name:'T',version:'1',pages:[{id:'market',name:'{item} Detail',width:816,height:1056,background:'#fff',repeat:{sourcePath:'submarkets',contextName:'market'},elements:[{id:'title',type:'text',name:'Title',x:0,y:0,width:100,height:20,text:'',binding:{path:'market.name'},style:{}},{id:'lease',type:'text',name:'Lease',x:0,y:30,width:100,height:20,text:'',binding:{path:'lease.tenant'},repeat:{sourcePath:'leasing',contextName:'lease',direction:'vertical',maximumItems:2,spacing:5},style:{}}]}]};

describe('report repeaters',()=>it('expands pages and components with contextual bindings',()=>{const pages=expandTemplatePages(template,{submarkets:[{name:'O’Hare'},{name:'I-55'}],leasing:[{tenant:'A'},{tenant:'B'},{tenant:'C'}]});expect(pages).toHaveLength(2);expect(pages[0].name).toBe('O’Hare Detail');expect(pages[0].bindingContext).toEqual({name:'market',path:'submarkets[0]'});expect(pages[0].elements.filter(item=>item.name.startsWith('Lease'))).toHaveLength(2);expect(pages[0].elements[1].bindingContext).toEqual({name:'lease',path:'leasing[0]'});}))

