import { expect, it } from "vitest";
import { validateInDesignPackage, type InDesignValidation } from "./exportContract.ts";
const valid: InDesignValidation = { pageCount: 44, qaPdfPages: 44, missingLinks: 0,
  substitutedFonts: 0, oversetFrames: 0, oversetCells: 0, nativeTextFrames: 100,
  nativeTables: 18, reopened: true, relocated: true, idmlImportValidated: false };
it("omits unvalidated IDML even when the INDD package passes", () => {
  expect(validateInDesignPackage(valid, 44)).toEqual({ accepted: true, failures: [], includeIdml: false });
});
it.each([
  { pageCount: 2 }, { qaPdfPages: 2 }, { missingLinks: 1 }, { substitutedFonts: 1 },
  { oversetFrames: 1 }, { oversetCells: 1 }, { nativeTextFrames: 0 }, { nativeTables: 0 },
  { reopened: false }, { relocated: false },
])("rejects an incomplete package: %j", override => {
  expect(validateInDesignPackage({ ...valid, ...override, idmlImportValidated: true }, 44).accepted).toBe(false);
});
