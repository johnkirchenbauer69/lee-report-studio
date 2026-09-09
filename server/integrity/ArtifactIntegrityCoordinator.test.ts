import { describe, expect, it } from "vitest";
import { ArtifactIntegrityCoordinator } from "./ArtifactIntegrityCoordinator";

describe("ArtifactIntegrityCoordinator", () => {
  it("does not allow an artifact write to interleave with an asset deletion scan", async () => {
    const coordinator = new ArtifactIntegrityCoordinator();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const deletion = coordinator.runExclusive(async () => {
      order.push("delete-scan");
      await gate;
      order.push("delete-bytes");
    });
    const artifactWrite = coordinator.runShared(async () => {
      order.push("artifact-write");
    });

    await Promise.resolve();
    expect(order).toEqual(["delete-scan"]);
    release();
    await Promise.all([deletion, artifactWrite]);
    expect(order).toEqual(["delete-scan", "delete-bytes", "artifact-write"]);
  });

  it("allows independent artifact writes to proceed concurrently", async () => {
    const coordinator = new ArtifactIntegrityCoordinator();
    let entered = 0;
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (bothEntered = resolve));
    const write = () =>
      coordinator.runShared(async () => {
        entered += 1;
        if (entered === 2) bothEntered();
        await gate;
      });

    const writes = [write(), write()];
    await ready;
    release();
    await Promise.all(writes);
    expect(entered).toBe(2);
  });
});
