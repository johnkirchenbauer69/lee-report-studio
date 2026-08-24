export interface ChicagoSubmarketIdentity {
  id: string;
  canonicalName: string;
  displayName: string;
  aliases?: readonly string[];
}

export const CHICAGO_SUBMARKETS: readonly ChicagoSubmarketIdentity[] = [
  ["central-dupage", "Central DuPage"],
  ["chicago-south", "Chicago South"],
  ["fox-valley", "Fox Valley"],
  ["i55-corridor", "I-55 Corridor"],
  ["i57-corridor", "I-57 Corridor"],
  [
    "i80-joliet",
    "I-80 Corridor/Joliet",
    "I-80/Joliet Area",
    ["I-80/Joliet", "I-80 Joliet", "I-80 Corridor / Joliet"],
  ],
  ["i88-corridor", "I-88 Corridor"],
  ["lake-county", "Lake County"],
  ["north-cook", "North Cook"],
  ["north-dupage", "North DuPage"],
  ["north-kane", "North Kane"],
  ["northwest-cook", "Northwest Cook"],
  ["northwest-indiana", "Northwest Indiana"],
  ["ohare", "O'Hare", "O'Hare", ["O’Hare"]],
  ["south-cook", "South Cook"],
  ["southeast-wisconsin", "Southeast Wisconsin"],
  ["southwest-cook", "Southwest Cook"],
  ["west-cook", "West Cook"],
].map(([id, canonicalName, displayName, aliases]) => ({
  id: id as string,
  canonicalName: canonicalName as string,
  displayName: (displayName as string | undefined) ?? (canonicalName as string),
  aliases: aliases as readonly string[] | undefined,
}));

const normalized = (value: string) =>
  value.trim().toLocaleLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ");

const identityByValue = new Map<string, ChicagoSubmarketIdentity>();
for (const identity of CHICAGO_SUBMARKETS)
  for (const value of [
    identity.id,
    identity.canonicalName,
    identity.displayName,
    ...(identity.aliases ?? []),
  ])
    identityByValue.set(normalized(value), identity);

export const resolveChicagoSubmarket = (value: string) =>
  identityByValue.get(normalized(value));

export const canonicalChicagoSubmarket = (value: string) =>
  resolveChicagoSubmarket(value)?.canonicalName;

export const chicagoSubmarketId = (value: string) =>
  resolveChicagoSubmarket(value)?.id;

export const CHICAGO_INDUSTRIAL_REPORT_SUBMARKETS = CHICAGO_SUBMARKETS.map(
  ({ canonicalName }) => canonicalName,
);
