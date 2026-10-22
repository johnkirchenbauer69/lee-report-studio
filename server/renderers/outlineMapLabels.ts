import * as fontkit from "fontkit";

/** Portable vector labels for linked map artwork; page narratives and tables stay native text. */
export function outlineMapLabels(svg: string, regularBytes: Buffer, boldBytes: Buffer): string {
  const regular = fontkit.create(regularBytes), bold = fontkit.create(boldBytes);
  if (!("layout" in regular) || !("layout" in bold)) throw new Error("Map labels require individual font faces");
  return svg.replace(/<text\s+([^>]*)>([^<]*)<\/text>/g, (_match, attributes: string, encoded: string) => {
    const attribute = (key: string) => attributes.match(new RegExp(`(?:^|\\s)${key}="([^"]*)"`))?.[1];
    const text = encoded.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    const font = Number(attribute("font-weight") ?? 400) >= 600 ? bold : regular;
    const size = Number(attribute("font-size")), x = Number(attribute("x")), y = Number(attribute("y"));
    if (![size, x, y].every(Number.isFinite) || size <= 0) throw new Error("Invalid map label geometry");
    const run = font.layout(text), scale = size / font.unitsPerEm;
    const width = run.positions.reduce((sum, position) => sum + position.xAdvance, 0) * scale;
    let cursor = attribute("text-anchor") === "middle" ? x - width / 2 : x;
    const fill = attribute("fill") ?? "#47535b", stroke = attribute("stroke");
    if (![fill, ...(stroke ? [stroke] : [])].every(color => /^(#[a-fA-F0-9]{6}|white)$/.test(color))) throw new Error("Invalid map label paint");
    return `<g><title>${encoded}</title>${run.glyphs.map((glyph, index) => {
      const position = run.positions[index]!;
      const outline = `<path d="${glyph.path.toSVG()}" transform="translate(${cursor + position.xOffset * scale},${y - position.yOffset * scale}) scale(${scale},${-scale})" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="2" paint-order="stroke" stroke-linejoin="round" vector-effect="non-scaling-stroke"` : ""}/>`;
      cursor += position.xAdvance * scale;
      return outline;
    }).join("")}</g>`;
  });
}
