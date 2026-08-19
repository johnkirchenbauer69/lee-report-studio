interface Props { onBind: (path: string, format?: string) => void; }
const fields = [
  ['report.title','Report → Title','text'],['report.period','Report → Period','text'],
  ['overall_market.inventory_sf','Overall Market → Inventory','sf'],['overall_market.vacancy_rate','Overall Market → Vacancy','percentage'],
  ['overall_market.availability_rate','Overall Market → Availability','percentage'],['overall_market.net_absorption','Overall Market → Net Absorption','sf'],
  ['overall_market.leasing_activity_sf','Overall Market → Leasing Activity','sf'],['overall_market.under_construction_sf','Overall Market → Under Construction','sf'],
  ['market.name','Current Market → Name','text'],['market.vacancy_rate','Current Market → Vacancy','percentage'],['market.availability_rate','Current Market → Availability','percentage'],
];
export function DataBrowser({ onBind }: Props) {
  return <div className="data-browser"><div className="panel-title">Connect Data</div><p>Click a business field to bind it to the selected element.</p>{fields.map(([path,label,format]) => <button key={path} onClick={() => onBind(path, format)}><span>{label}</span><code>{path}</code></button>)}</div>;
}
