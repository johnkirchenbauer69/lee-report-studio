export const MARKETING_CHART_BASE = { width: 360, height: 216 } as const;

export const marketingChartTheme = {
  palette: {
    red: "#CD1442",
    merlot: "#4E131E",
    navy: "#003146",
    vacancy: "#337B9A",
    gray: "#696C6D",
  },
  typography: {
    family: "Nunito Sans",
    weight: 600,
    tick: 7.05,
    axisTitle: 8,
    legend: 8.2,
    barLabel: 6.2,
  },
  gridWidth: 0.3,
  lineWidth: 0.84,
  dash: "4 3",
  margins: {
    availability: { left: 47.94, right: 13.33, top: 9.56, bottom: 35.63 },
    combination: { left: 35.36, right: 11.5, top: 11.64, bottom: 35.49 },
    sales: { left: 56.28, right: 48, top: 11.64, bottom: 35.49 },
    construction: { left: 35.36, right: 11.5, top: 11.64, bottom: 35.49 },
  },
  shadow: { dx: 3, dy: 3, blur: 1.4, opacity: 0.26 },
} as const;

export type MarketingChartId =
  | "availability_by_size"
  | "net_absorption_vacancy_availability"
  | "sales_volume_cap_rates"
  | "construction_uc_deliveries";
