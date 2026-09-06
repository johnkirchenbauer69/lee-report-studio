# Editor selection and styling rules

Template saves, version creation, and publishing retain the active page ID,
selection (when the element IDs still exist), and zoom. Opening any draft or
published version is a distinct navigation operation and starts on page index
zero.

Legacy `borderRadius` values are migrated into the structured four-corner
model. Linked corners remain the default. Every radius is clamped to half of
the element's smaller dimension.

Shape union is an explicit boolean operation powered by `polygon-clipping`.
It accepts two or more intersecting top-level shapes, bakes their rotations
into one editable path, replaces the sources in one undo step, and rejects a
disconnected result. The resulting shape copies fill, stroke, opacity,
shadow, and bevel from the topmost selected shape; incompatible styles are
not blended. Grouping remains a separate, non-destructive operation.

Advanced editor effects are rendered by the browser-based editor, preview,
and Chromium PDF pipeline. The deterministic fallback refuses these effects
instead of silently exporting a visually different document.
