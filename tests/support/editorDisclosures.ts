import type { Page } from "@playwright/test";

/** Open the actual UI disclosures before legacy editing assertions. */
export async function revealInspectorControls(page: Page) {
  for (const section of await page.locator(".inspector-section").all()) {
    if (
      (await section.isVisible()) &&
      !(await section.evaluate((node) => (node as HTMLDetailsElement).open))
    ) {
      await section.locator("summary").click();
    }
  }
}
export async function revealViewOptions(page: Page) {
  const details = page.locator(".view-options");
  if (
    (await details.count()) &&
    !(await details.evaluate((node) => (node as HTMLDetailsElement).open))
  )
    await details.locator("summary").click();
}
