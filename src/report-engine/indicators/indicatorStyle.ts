/** Shared publication styling; sizes come from the existing Overall Market table. */
export const INDICATOR_STYLE = Object.freeze({
  fontFamily: "Nunito Sans, Arial, sans-serif",
  fontSize: 9,
  color: "#123f55",
  bold: 700,
  regular: 400,
  up: "#8A941E",
  down: "#CD1442",
  neutral: "#4E131E",
  unavailable: "#6B7280",
});

export function indicatorColor(direction: string) {
  return direction === "up" ? INDICATOR_STYLE.up
    : direction === "down" ? INDICATOR_STYLE.down
    : direction === "unavailable" ? INDICATOR_STYLE.unavailable : INDICATOR_STYLE.neutral;
}
