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
  // `combination` and `sales` intentionally share one margin so the Net
  // Absorption and Sales Volume charts render with identical plot-area
  // proportions. Both now place their line-series value axis on the left
  // (see MarketingChart's CombinationChart), so the left margin is sized to
  // fit that axis's widest label (whole-dollar PSF or whole-percent ticks)
  // and the right margin matches the other left-axis charts below.
  margins: {
    availability: { left: 47.94, right: 13.33, top: 9.56, bottom: 35.63 },
    combination: { left: 44, right: 13.33, top: 11.64, bottom: 35.49 },
    sales: { left: 44, right: 13.33, top: 11.64, bottom: 35.49 },
    construction: { left: 35.36, right: 11.5, top: 11.64, bottom: 35.49 },
  },
  shadow: { dx: 3, dy: 3, blur: 1.4, opacity: 0.26 },
  // Count chips (distinct buildings / qualifying sales) reuse the dark-blue
  // property-card footer navy so they read as the same report vocabulary.
  countChip: {
    fill: "#003C50",
    text: "#FFFFFF",
    fontSize: 6,
    fontWeight: 700,
    height: 9,
    paddingX: 2.6,
    radius: 1.8,
    /** Gap between the bar top and an inside chip / between chip and label. */
    inset: 2.5,
    /** Approximate advance width of a tabular digit, as a share of font size. */
    digitWidth: 0.6,
  },
} as const;

export type MarketingChartId =
  | "availability_by_size"
  | "net_absorption_vacancy_availability"
  | "sales_volume_cap_rates"
  | "construction_uc_deliveries";
