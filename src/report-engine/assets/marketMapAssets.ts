export const MARKET_MAP_ASSET_REGISTRY = {
  "overall-market": "/report-assets/maps/Overall_Market_Map.jpg",
  "central-dupage": "/report-assets/maps/Central_DuPage_Map.jpg",
  "chicago-south": "/report-assets/maps/Chicago_South_Map.jpg",
  "fox-valley": "/report-assets/maps/Fox_Valley_Map.jpg",
  "i55-corridor": "/report-assets/maps/I-55_Corridor_Map.jpg",
  "i57-corridor": "/report-assets/maps/I-57_Corridor_Map.jpg",
  "i80-joliet": "/report-assets/maps/I-80_Corridor_Map.jpg",
  "i88-corridor": "/report-assets/maps/I-88_Corridor_Map.jpg",
  "lake-county": "/report-assets/maps/Lake_County_Map.jpg",
  "north-cook": "/report-assets/maps/North_Cook_Map.jpg",
  "north-dupage": "/report-assets/maps/North_DuPage_Map.jpg",
  "north-kane": "/report-assets/maps/North_Kane_Map.jpg",
  "northwest-cook": "/report-assets/maps/Northwest_Cook_Map.jpg",
  "northwest-indiana": "/report-assets/maps/Northwest_Indiana_Map.jpg",
  ohare: "/report-assets/maps/O'Hare_Map.jpg",
  "south-cook": "/report-assets/maps/South_Cook_Map.jpg",
  "southeast-wisconsin": "/report-assets/maps/Southeast_Wisconsin_Map.jpg",
  "southwest-cook": "/report-assets/maps/Southwest_Cook_Map.jpg",
  "west-cook": "/report-assets/maps/West_Cook_Map.jpg",
} as const;

export type MarketMapId = keyof typeof MARKET_MAP_ASSET_REGISTRY;

export function resolveMarketMapAsset(
  id: string,
  registry: Readonly<Record<string, string>> = MARKET_MAP_ASSET_REGISTRY,
) {
  const asset = registry[id];
  if (!asset)
    throw new Error(
      `Required managed map asset is unavailable for canonical market ID: ${id || "(missing)"}.`,
    );
  return asset;
}
