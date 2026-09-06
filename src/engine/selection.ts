export function nextSelection(
  current: readonly string[],
  id: string,
  additive: boolean,
): string[] {
  if (!additive) return [id];
  return current.includes(id)
    ? current.filter((candidate) => candidate !== id)
    : [...current, id];
}
