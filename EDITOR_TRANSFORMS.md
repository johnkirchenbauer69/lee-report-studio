# Editor transforms

## Rotation contract

Every text, shape, image, table, and chart element stores a numeric `rotation` in clockwise degrees. Hydration normalizes legacy or out-of-range values to `[0, 360)`. A missing value migrates to `0`, so existing templates remain visually unchanged.

`src/engine/geometry.ts` is the shared geometry authority. It rotates around the element center and exposes rotated corners, axis-aligned visual bounds, inverse-transform hit testing, normalization, and angle snapping. Editor snapping, alignment, page overflow, and export preflight use the rotated visual bounds instead of the unrotated source frame. Browser hit testing and selection controls use the same centered CSS transform.

The handle is free-rotation with magnetic stops every 45° within 4°. Hold Shift for a strict 15° grid; hold Alt to bypass snapping. The Inspector accepts arbitrary numeric input and normalizes it. Pointer gestures are coalesced into one history transaction, so undo/redo restores the pre-drag and final angles rather than every pointer event.

Corner resize projects pointer movement into the element's local rotated axes and keeps the opposite visual corner fixed. Shift preserves the original aspect ratio. Rotation is never reset by resize, duplicate, copy/paste, save/load, template generation, or proportional group resize.

## Known limitation

Elements sharing a `groupId` retain their individual rotations during proportional group resize and group movement. A single group-level rotation gesture around a shared group center is not yet exposed; selecting multiple elements and changing rotation rotates each member around its own center. This is intentionally documented rather than silently flattening angles.

The server Chromium PDF renderer is the fidelity path and consumes the same browser component/transform semantics. The offline `pdf-lib` fallback supports centered text/image/basic-shape rotation but deliberately refuses rotated tables/charts and managed-font reports instead of producing a misleading PDF.
