/**
 * Serializes reference-creating repository writes with destructive asset
 * operations in this API process. Atomic files protect individual records;
 * this coordinator protects the cross-repository reference invariant.
 */
export class ArtifactIntegrityCoordinator {
  private activeShared = 0;
  private activeExclusive = false;
  private readonly queue: Array<{
    mode: "shared" | "exclusive";
    start: () => void;
  }> = [];

  runShared<T>(operation: () => Promise<T>): Promise<T> {
    return this.schedule("shared", operation);
  }

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.schedule("exclusive", operation);
  }

  private schedule<T>(
    mode: "shared" | "exclusive",
    operation: () => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        mode,
        start: () => {
          if (mode === "shared") this.activeShared += 1;
          else this.activeExclusive = true;
          void Promise.resolve()
            .then(operation)
            .then(resolve, reject)
            .finally(() => {
              if (mode === "shared") this.activeShared -= 1;
              else this.activeExclusive = false;
              this.drain();
            });
        },
      });
      this.drain();
    });
  }

  private drain() {
    if (this.activeExclusive || !this.queue.length) return;
    if (this.queue[0]!.mode === "exclusive") {
      if (this.activeShared) return;
      this.queue.shift()!.start();
      return;
    }
    while (this.queue[0]?.mode === "shared") this.queue.shift()!.start();
  }
}
