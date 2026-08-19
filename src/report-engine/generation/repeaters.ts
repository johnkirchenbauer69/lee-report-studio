import { getByPath } from '../../engine/bindings';
import type { ReportElement, ReportPage, ReportTemplate, RepeatRule } from '../../types/report';

function orderedItems(data: unknown, rule: RepeatRule): { item: unknown; index: number }[] {
  const source = getByPath(data, rule.sourcePath);
  if (!Array.isArray(source)) return [];
  const indexed = source.map((item,index)=>({item,index}));
  if (rule.sortBy) indexed.sort((a,b)=>String(getByPath(a.item,rule.sortBy!)).localeCompare(String(getByPath(b.item,rule.sortBy!)))*(rule.sortOrder==='descending'?-1:1));
  return indexed.slice(0,rule.maximumItems??indexed.length);
}

export function expandRepeatingElements(elements: ReportElement[], data: unknown): ReportElement[] {
  return elements.flatMap(element => {
    if (!element.repeat) return element;
    const rule = element.repeat;
    const spacing = rule.spacing ?? 12;
    return orderedItems(data, rule).map(({index}, outputIndex) => ({
      ...structuredClone(element),
      id:`${element.id}-repeat-${index}`,
      name:`${element.name} ${outputIndex+1}`,
      x:element.x+(rule.direction==='horizontal'?(element.width+spacing)*outputIndex:0),
      y:element.y+(rule.direction!=='horizontal'?(element.height+spacing)*outputIndex:0),
      repeat:undefined,
      bindingContext:{name:rule.contextName??'item',path:`${rule.sourcePath}[${index}]`},
    } as ReportElement));
  });
}

export function expandTemplatePages(template: ReportTemplate, data: unknown): ReportPage[] {
  return template.pages.flatMap(page => {
    if (!page.repeat) return {...structuredClone(page),elements:expandRepeatingElements(page.elements,data)};
    const rule = page.repeat;
    return orderedItems(data, rule).map(({item,index}, outputIndex) => {
      const label = String(getByPath(item,'name')??outputIndex+1);
      const context = {name:rule.contextName,path:`${rule.sourcePath}[${index}]`};
      return {...structuredClone(page),id:`${page.id}-repeat-${index}`,name:page.name.replace(/\{item\}/g,label),repeat:undefined,bindingContext:context,elements:expandRepeatingElements(page.elements,data).map(element=>({...element,bindingContext:element.bindingContext??context}))};
    });
  });
}

