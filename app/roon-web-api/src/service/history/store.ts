import fs from "node:fs/promises";
import path from "node:path";
import {
  HistoryCheckpoint,
  HistoryEvent,
  historyLimits,
  HistorySnapshot,
  order,
  retentionMs,
  validEvent,
} from "./model";

/** A single bounded snapshot; concurrent writes coalesce into the latest state. */
export class HistoryStore {
  snapshot: HistorySnapshot;
  error?: string;
  private writable = true;
  private dirty = false;
  private writing?: Promise<void>;
  constructor(
    readonly file: string,
    private readonly now = Date.now
  ) {
    this.snapshot = { version: 1, startedAt: new Date(now()).toISOString(), revision: 0, events: [], checkpoints: [] };
  }

  async open() {
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.rm(`${this.file}.tmp`, { force: true });
      const stat = await fs.stat(this.file);
      if (stat.size > historyLimits.bytes) throw new Error("History file exceeds its storage limit.");
      const value: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!this.validSnapshot(value)) throw new Error("The saved listening history could not be read.");
      this.snapshot = value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.error = "Listening history could not be loaded. Check the bridge's history storage.";
        this.writable = false; // Preserve an unreadable existing file for recovery.
        return;
      }
    }
    this.prune();
    await this.save();
  }

  private validSnapshot(value: unknown): value is HistorySnapshot {
    const v = value as (Omit<HistorySnapshot, "version"> & { version: unknown }) | null;
    return (
      !!v &&
      v.version === 1 &&
      typeof v.startedAt === "string" &&
      Number.isFinite(Date.parse(v.startedAt)) &&
      Number.isSafeInteger(v.revision) &&
      v.revision >= 0 &&
      Array.isArray(v.events) &&
      v.events.every(validEvent) &&
      Array.isArray(v.checkpoints) &&
      v.checkpoints.length <= historyLimits.sessions &&
      v.checkpoints.every(
        (c) =>
          validEvent(c.event) &&
          typeof c.signature === "string" &&
          c.signature.length <= 5000 &&
          Number.isFinite(c.position) &&
          Number.isFinite(c.seenAt)
      )
    );
  }

  retained(): HistoryEvent[] {
    const cutoff = this.now() - retentionMs;
    return this.snapshot.events.filter((e) => Date.parse(e.observedAt) >= cutoff);
  }

  add(event: HistoryEvent) {
    if (!validEvent(event) || !this.writable || this.snapshot.events.some((e) => e.id === event.id)) return;
    this.snapshot.events.push(event);
    this.snapshot.revision++;
    this.prune();
    void this.save();
  }

  checkpoint(checkpoints: HistoryCheckpoint[]) {
    if (!this.writable) return;
    this.snapshot.checkpoints = checkpoints.slice(-historyLimits.sessions);
    this.prune();
    void this.save();
  }

  prune() {
    const previous = this.snapshot.events.length;
    this.snapshot.events = this.retained().sort(order).slice(0, historyLimits.events);
    this.snapshot.checkpoints = this.snapshot.checkpoints
      .filter((c) => c.seenAt >= this.now() - 300000)
      .slice(-historyLimits.sessions);
    let bytes = Buffer.byteLength(JSON.stringify(this.snapshot));
    while (bytes > historyLimits.bytes - 1024) {
      const collection = this.snapshot.events.length ? this.snapshot.events : this.snapshot.checkpoints;
      const removed = collection.pop();
      if (!removed) break;
      bytes -= Buffer.byteLength(JSON.stringify(removed)) + (collection.length ? 1 : 0);
    }
    if (this.snapshot.events.length !== previous) this.snapshot.revision++;
  }

  async cleanup() {
    this.prune();
    await this.save();
  }

  save(): Promise<void> {
    if (!this.writable) return Promise.resolve();
    this.dirty = true;
    if (!this.writing) {
      this.writing = this.writePending().finally(() => {
        this.writing = undefined;
      });
    }
    return this.writing;
  }

  private async writePending() {
    while (this.dirty) {
      this.dirty = false;
      this.prune();
      try {
        await fs.writeFile(`${this.file}.tmp`, JSON.stringify(this.snapshot), { mode: 0o600 });
        await fs.rename(`${this.file}.tmp`, this.file);
        this.error = undefined;
      } catch {
        this.error = "Listening history could not be saved. Check the bridge's available storage.";
        this.dirty = false; // Retry on the next event/checkpoint; never build a retry queue.
        return;
      }
    }
  }
}
