/** Portable, human-readable paths; internal IDs never form archive names. */
export function readableName(value: string, max = 100) {
  let result = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, max)
    .replace(/[. ]+$/g, "");
  if (!result) result = "Unnamed";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(result))
    result = result.replace(/^([^.]+)/, "$1 Market");
  return result;
}
export function displayPeriod(period: string) {
  return period.replace(/^(\d{4})\s+(Q[1-4])$/i, "$2 $1");
}
export function uniqueName(name: string, used: Set<string>) {
  const match = name.match(/^(.*?)(\.[a-z0-9]+)?$/i)!;
  let candidate = name,
    index = 2;
  while (used.has(candidate.toLocaleLowerCase("en-US")))
    candidate = `${match[1]} (${index++})${match[2] ?? ""}`;
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}
export function assertArchivePath(path: string) {
  if (
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p !== readableName(p, 160))
  )
    throw new Error("Unsafe export filename.");
}
