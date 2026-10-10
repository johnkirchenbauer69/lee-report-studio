/** Display-only repair of UTF-8 bytes incorrectly decoded as Latin-1 by older uploads.
 * A round trip is required. Storage names, paths and binary data never change. */
export function displayAssetName(name: string): string {
  if (!/[ÃÂÅÄâ]/.test(name) || [...name].some(c => c.charCodeAt(0) > 255)) return name;
  try {
    const bytes = Uint8Array.from([...name], c => c.charCodeAt(0));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const encoded = new TextEncoder().encode(repaired);
    if (encoded.length !== bytes.length || encoded.some((b,i)=>b!==bytes[i])) return name;
    return repaired;
  } catch { return name; }
}
