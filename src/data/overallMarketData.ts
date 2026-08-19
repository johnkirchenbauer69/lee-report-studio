import type { PeriodMetric, PropertyHighlight, SourceNote, SubmarketMetric, TransactionRecord } from '../types/marketReport';

export const submarkets:SubmarketMetric[] = [
  ['Central DuPage',21350998,0,367842,1,126800,.0281,.0606,8.4,67800000],
  ['Chicago South',117859927,266580,1035188,.9006112899,37457,.0471,.0854,8.61,62600000],
  ['Fox Valley',44244807,118332,1192780,.3007711867,-64775,.046,.0859,5.66,14300000],
  ['I-55 Corridor',117885102,334708,1759871,.2126194503,756616,.0572,.125,7.21,44700000],
  ['I-57 Corridor',32877057,100000,970123,1,27000,.0849,.1311,4.95,125600000],
  ['I-80/Joliet Area',117027493,387920,1826062,.1920559105,816739,.0333,.0742,8.48,4300000],
  ['I-88 Corridor',73502626,150162,168037,.8735397561,51853,.0573,.0859,7.95,57700000],
  ['Lake County',86568269,0,0,0,437127,.0425,.0619,7.82,134400000],
  ['North Cook',36172715,0,0,0,351520,.0607,.0913,10,177500000],
  ['North DuPage',65846025,0,664476,.2243873368,-204017,.0285,.0817,10.22,58900000],
  ['North Kane',43413292,0,720758,.5950679701,481260,.0345,.0678,6.58,30700000],
  ['Northwest Cook',48715505,0,88000,0,104716,.055,.0956,11.5,116600000],
  ['Northwest Indiana',77222175,0,2602194,.0150533296,285674,.0357,.064,12,62100000],
  ["O'Hare",96713018,294070,765020,.5334792551,716189,.0457,.0803,9.08,27300000],
  ['South Cook',93143167,0,363942,.0180550747,43805,.057,.0796,6.63,113400000],
  ['Southeast Wisconsin',90737983,0,840635,0,891612,.073,.0819,6.99,120800000],
  ['Southwest Cook',28355031,0,0,0,31547,.056,.0786,4.6,7600000],
  ['West Cook',66346013,0,547619,.6530434481,315688,.0595,.1005,12.41,9800000],
].map(([name,inventorySf,deliveredSf,underConstructionSf,speculativeShare,netAbsorptionSf,vacancyRate,availabilityRate,askingNetRentPsf,salesVolume])=>({name,inventorySf,deliveredSf,underConstructionSf,speculativeShare,netAbsorptionSf,vacancyRate,availabilityRate,askingNetRentPsf,salesVolume} as SubmarketMetric));

export const periods:PeriodMetric[] = [
  {period:'2026 Q2',netAbsorption12MonthSf:17654829,vacancyRate:.0496,availabilityRate:.0853,underConstructionSf:13912547,leasingActivitySf:14584206},
  {period:'2026 Q1',netAbsorption12MonthSf:17675415,vacancyRate:.0585,availabilityRate:.0885,underConstructionSf:13111050,leasingActivitySf:24335480},
  {period:'2025 Q4',netAbsorption12MonthSf:18086895,vacancyRate:.0606,availabilityRate:.0894,underConstructionSf:12459437,leasingActivitySf:13783974},
  {period:'2025 Q3',netAbsorption12MonthSf:12657528,vacancyRate:.062,availabilityRate:.0906,underConstructionSf:12864793,leasingActivitySf:12688655},
  {period:'2025 Q2',netAbsorption12MonthSf:4547144,vacancyRate:.0617,availabilityRate:.0893,underConstructionSf:12423699,leasingActivitySf:15845047},
];

export const topLeases:TransactionRecord[]=[
  {party:'Hyundai Translead',amount:906517,address:'3835 Youngs Rd, Channahon, IL 60410',type:'Direct / New'},
  {party:'Kehe Distributors',amount:802440,address:'1850 S Cherry Hill Rd, Joliet, IL 60432',type:'Direct / New'},
  {party:'Distribution 2000',amount:453568,address:'1120-1140 Remington Blvd, Romeoville, IL 60446',type:'Direct / New'},
];

export const topSales:TransactionRecord[]=[
  {party:'Realty Income Corporation',amount:124000000,address:'23301 S Central Ave, University Park, IL 60484',type:'Investment'},
  {party:'Realty Income Corporation',amount:102745301,address:'3101 Protection Pky, Glenview, IL 60062',type:'Investment'},
  {party:'Realty Income Corporation',amount:73711746,address:'2501 Sanders Rd, Glenview, IL 60062',type:'Investment'},
];

export const topAvailabilities:PropertyHighlight[]=[
  {address:'325 State Rt 31 - Building G, Montgomery, IL 60543',sizeSf:1074982,type:'Warehouse - Direct',sponsor:'',image:'/report-assets/availability-montgomery.png'},
  {address:'2655 113th Ave, Kenosha, WI 53144',sizeSf:918624,type:'Warehouse - Direct',sponsor:'',image:'/report-assets/availability-kenosha.png'},
  {address:'25101 S Ridgeland Ave, Monee, IL 60449',sizeSf:879040,type:'Warehouse - Direct',sponsor:'',image:'/report-assets/availability-monee.png'},
];

export const topDeliveries:PropertyHighlight[]=[
  {address:'251 E Millsdale Rd, Elwood, IL 60421',sizeSf:295000,type:'Built-to-Suit',sponsor:'Saxum Real Estate',image:'/report-assets/delivery-elwood.png'},
  {address:'17658 Bluff Rd, Woodridge, IL 60517',sizeSf:224667,type:'Speculative',sponsor:'Crow Holdings',image:'/report-assets/delivery-woodridge.png'},
  {address:'2700 York Rd, Elk Grove Village, IL 60007',sizeSf:122470,type:'Speculative',sponsor:'The Missner Group Company',image:'/report-assets/delivery-elk-grove.png'},
];

export const topConstruction:PropertyHighlight[]=[
  {address:'26351 W 143rd St, Plainfield, IL 60544',sizeSf:1209000,type:'Speculative',sponsor:'DHL Supply Chain Solution',image:'/report-assets/construction-plainfield.png'},
  {address:'2105 E 181st Ave, Hebron, IN 46341',sizeSf:1200000,type:'Built-to-Suit',sponsor:'Venture One Real Estate',image:'/report-assets/construction-hebron.png'},
  {address:'21012 W Mississippi St, Elwood, IL 60421',sizeSf:1106256,type:'Built-to-Suit',sponsor:'CJ Logistics',image:'/report-assets/construction-elwood.png'},
];

const number=(value:number)=>value.toLocaleString('en-US');
const money=(value:number)=>`$${number(value)}`;
const percent=(value:number,decimals=2)=>`${(value*100).toFixed(decimals)}%`;
const rent=(value:number)=>`$${value.toFixed(2)}`;
const minimum=(key:keyof SubmarketMetric)=>submarkets.reduce((best,item)=>Number(item[key])<Number(best[key])?item:best).name;
const maximum=(key:keyof SubmarketMetric)=>submarkets.reduce((best,item)=>Number(item[key])>Number(best[key])?item:best).name;

const marketTotals={inventorySf:1257981203,deliveredSf:1651772,underConstructionSf:13912547,speculativeShare:.3381477655,netAbsorptionSf:5206811,vacancyRate:.0496057574,availabilityRate:.0852911411,askingNetRentPsf:8.4277175967,salesVolume:1236100000};
export const submarketTableRows=[
  ...submarkets.map(item=>({kind:'detail',name:item.name,inventory:number(item.inventorySf),delivered:number(item.deliveredSf),underConstruction:number(item.underConstructionSf),speculative:percent(item.speculativeShare,0),absorption:number(item.name==='Southeast Wisconsin'?891615:item.netAbsorptionSf),vacancy:percent(item.vacancyRate),availability:percent(item.availabilityRate),rent:rent(item.askingNetRentPsf),sales:money(item.salesVolume)})),
  {kind:'total',name:'MARKET TOTALS',inventory:number(marketTotals.inventorySf),delivered:number(marketTotals.deliveredSf),underConstruction:number(marketTotals.underConstructionSf),speculative:percent(marketTotals.speculativeShare,0),absorption:number(marketTotals.netAbsorptionSf),vacancy:percent(marketTotals.vacancyRate),availability:percent(marketTotals.availabilityRate),rent:rent(marketTotals.askingNetRentPsf),sales:money(marketTotals.salesVolume)},
  {kind:'minimum',name:'SUBMARKET MIN',inventory:minimum('inventorySf'),delivered:minimum('deliveredSf'),underConstruction:minimum('underConstructionSf'),speculative:minimum('speculativeShare'),absorption:minimum('netAbsorptionSf'),vacancy:minimum('vacancyRate'),availability:minimum('availabilityRate'),rent:minimum('askingNetRentPsf'),sales:minimum('salesVolume')},
  {kind:'maximum',name:'SUBMARKET MAX',inventory:maximum('inventorySf'),delivered:maximum('deliveredSf'),underConstruction:maximum('underConstructionSf'),speculative:maximum('speculativeShare'),absorption:maximum('netAbsorptionSf'),vacancy:maximum('vacancyRate'),availability:maximum('availabilityRate'),rent:maximum('askingNetRentPsf'),sales:maximum('salesVolume')},
];

export const sourceNotes:SourceNote[]=[
  {field:'overallMarket.vacancyRate',approvedValue:.0496,alternateValue:.0484,authority:'Approved Q2 PDF',note:'Submarket weighted total rounds to 4.96%; market-indicator source workbook contains 4.84%.'},
  {field:'overallMarket.availabilityRate',approvedValue:.0853,alternateValue:.0846,authority:'Approved Q2 PDF',note:'Submarket weighted total rounds to 8.53%; market-indicator source workbook contains 8.46%.'},
  {field:'overallMarket.underConstructionSf',approvedValue:13912547,alternateValue:13779195,authority:'Approved Q2 PDF',note:'Submarket total is used on pages 2 and 3; the indicator workbook contains a different aggregate.'},
  {field:'submarkets.Southeast Wisconsin.netAbsorptionSf',approvedValue:891615,alternateValue:891612,authority:'Approved Q2 PDF',note:'The approved table row is three square feet above the authoritative workbook value; the market total reconciles to the workbook.'},
];

const indicatorRows=[
  {metric:'▼  12 Month Net Absorption (SF)',q2:'17,654,829',q1:'17,675,415',q4:'18,086,895',q3:'12,657,528',prior:'4,547,144'},
  {metric:'▼  Vacancy Rate',q2:'4.96%',q1:'5.85%',q4:'6.06%',q3:'6.20%',prior:'6.17%'},
  {metric:'▼  Availability Rate',q2:'8.53%',q1:'8.85%',q4:'8.94%',q3:'9.06%',prior:'8.93%'},
  {metric:'▲  Under Construction (SF)',q2:'13,912,547',q1:'13,111,050',q4:'12,459,437',q3:'12,864,793',prior:'12,423,699'},
  {metric:'▼  Total Leasing Activity (SF)',q2:'14,584,206',q1:'24,335,480',q4:'13,783,974',q3:'12,688,655',prior:'15,845,047'},
];
const topLeaseRows=topLeases.map(item=>({party:item.party,amount:`${number(item.amount)} SF`,address:item.address,type:item.type}));
const topSaleRows=topSales.map(item=>({party:item.party,amount:money(item.amount),address:item.address,type:item.type}));

export const overallMarketData={
  report:{title:'Industrial Market Report',period:'Q2 2026',market:'Overall Market',preparedBy:'Lee & Associates of Illinois'},
  overallMarket:{...marketTotals,narrative:[
    'Overall industrial market fundamentals continued to improve in Q2 2026, supported by broad occupancy gains across the region. Vacancy declined to 4.96 percent from 5.85 percent in Q1 and 6.17 percent one year ago, while availability improved to 8.53 percent from 8.85 percent in the prior quarter and 8.93 percent in Q2 2025. Quarterly net absorption totaled 5.21 million square feet, reflecting widespread tenant move-ins across the tracked submarkets. Development remained elevated, with 13.91 million square feet under construction, up from 13.11 million square feet in Q1, while approximately 1.65 million square feet delivered during the quarter. Investment activity was also substantial, with regional sales volume totaling approximately $1.24 billion.',
    'Demand remained geographically diverse, led by Southeast Wisconsin, the I-80 Corridor/Joliet, and the I-55 Corridor, each of which recorded significant positive absorption. Modern distribution facilities continued to attract large logistics users, while established manufacturing and infill locations maintained steady activity across a broad range of building sizes. North DuPage posted the softest quarterly absorption as several larger spaces returned to the market, although its vacancy remained among the lowest of the tracked submarkets. Despite a more measured transaction environment, declining vacancy, improving availability, continued construction, and a diversified occupier base indicate that the regional industrial market remains on firm footing heading into the second half of 2026.'
  ].join('\n\n')},
  submarkets,submarketTableRows,periods,indicatorRows,topLeases,topSales,topLeaseRows,topSaleRows,topAvailabilities,topDeliveries,topConstruction,sourceNotes,
};
