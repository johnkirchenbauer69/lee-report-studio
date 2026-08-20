import type { ElementStyle, Typography } from "../types/report";

export const typographyDefaults: Typography = {
  fontFamily: "Inter",
  fontWeight: 400,
  fontSize: 16,
  color: "#111827",
  letterSpacing: 0,
  lineHeight: 1.2,
  textAlign: "left",
  verticalAlign: "top",
  italic: false,
  underline: false,
};

/** Resolve both legacy top-level text styles and the current typography model. */
export function resolveTypography(style: ElementStyle): Typography {
  return {
    ...typographyDefaults,
    fontFamily: style.fontFamily ?? typographyDefaults.fontFamily,
    fontWeight: style.fontWeight ?? typographyDefaults.fontWeight,
    fontSize: style.fontSize ?? typographyDefaults.fontSize,
    color: style.color ?? typographyDefaults.color,
    letterSpacing: style.letterSpacing ?? typographyDefaults.letterSpacing,
    lineHeight: style.lineHeight ?? typographyDefaults.lineHeight,
    textAlign: style.textAlign ?? typographyDefaults.textAlign,
    italic: style.italic ?? typographyDefaults.italic,
    underline:
      style.textDecoration === "underline" || typographyDefaults.underline,
    ...style.typography,
  };
}

export function withTypography(
  style: ElementStyle,
  patch: Partial<Typography>,
): ElementStyle {
  return { ...style, typography: { ...resolveTypography(style), ...patch } };
}

export const verticalAlignmentClass = (value: Typography["verticalAlign"]) =>
  `vertical-${value}`;
