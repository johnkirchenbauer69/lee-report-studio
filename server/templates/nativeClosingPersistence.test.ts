import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { FileSystemTemplateRepository } from "./FileSystemTemplateRepository";
import { sampleTemplate } from "../../src/data/sampleTemplate";

it("saves and reopens structured closing edits without changing a published template", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lee-native-closing-"));
  try {
    const repository = new FileSystemTemplateRepository(root);
    await repository.initialize(sampleTemplate);
    const published = await repository.publish(
      sampleTemplate.id,
      sampleTemplate.version,
    );
    const before = JSON.stringify(published.template);
    const draft = await repository.createVersion(
      published.id,
      published.version,
    );
    for (const page of draft.template.pages)
      for (const element of page.elements) {
        if (element.type !== "text" || !element.closingContent) continue;
        const content = element.closingContent;
        if (content.kind === "contacts") {
          content.contacts[0].email = "updated@example.com";
          content.contacts[0].isActive = false;
        } else if (content.kind === "company") {
          content.statistics[0].value = "$3+";
          content.openings[0].market = "Edited office";
        } else content.groups[0].items[0].description = "Edited description";
      }
    const saved = await repository.saveDraft(
      draft.id,
      draft.version,
      draft.template,
    );
    const reopened = await new FileSystemTemplateRepository(root).get(
      saved.id,
      saved.version,
    );
    expect(reopened?.template).toEqual(saved.template);
    expect(JSON.stringify(reopened?.template)).toContain("updated@example.com");
    expect(JSON.stringify(reopened?.template)).toContain("Edited office");
    expect(
      JSON.stringify(
        (await repository.get(published.id, published.version))?.template,
      ),
    ).toBe(before);
    await expect(
      repository.saveDraft(published.id, published.version, draft.template),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
