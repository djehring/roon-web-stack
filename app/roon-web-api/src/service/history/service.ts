import path from "node:path";
import { roon } from "@infrastructure";
import type { RoonServer } from "@model";
import { albumId, HistoryEvent, order, sharedCredits } from "./model";
import { HistoryRecorder } from "./recorder";
import { HistoryStore } from "./store";

export class HistoryService {
  readonly recorder: HistoryRecorder;
  constructor(readonly store: HistoryStore) {
    this.recorder = new HistoryRecorder(store);
  }

  page(kind: "tracks" | "albums", query: { roomId?: string; cursor?: string; limit?: string }) {
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Choose a page size from 1 to 200.");
    if (query.roomId && query.roomId.length > 300) throw new Error("Invalid room.");
    const coreId = this.recorder.coreId ?? "";
    const room = query.roomId ?? "";
    let asOf = new Date().toISOString();
    let after: { observedAt: string; id: string } | undefined;
    if (query.cursor) {
      if (query.cursor.length > 3000) throw new Error("Invalid history cursor.");
      try {
        const c = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as Record<string, unknown>;
        if (
          c.coreId !== coreId ||
          c.room !== room ||
          c.kind !== kind ||
          typeof c.asOf !== "string" ||
          typeof c.observedAt !== "string" ||
          typeof c.id !== "string" ||
          !Number.isFinite(Date.parse(c.asOf)) ||
          !Number.isFinite(Date.parse(c.observedAt))
        )
          throw new Error();
        asOf = c.asOf;
        after = { observedAt: c.observedAt, id: c.id };
      } catch {
        throw new Error("History changed. Refresh the list.");
      }
    }
    const retained = this.store.retained().filter((e) => e.coreId === coreId);
    const rooms = [...new Map(retained.map((e) => [e.zoneId, { id: e.zoneId, name: e.room }])).values()];
    let events = retained.filter((e) => (!room || e.zoneId === room) && e.qualifiedAt <= asOf).sort(order);
    if (kind === "albums") {
      const groups = new Map<string, HistoryEvent>();
      for (const event of events) {
        if (!event.album) continue;
        const id = albumId(event);
        const group = groups.get(id);
        if (group) group.artist = sharedCredits(group.artist, event.artist);
        // Keep the newest play as the representative; only the album response's
        // display credits change. Stored tracks and their resolution hints stay intact.
        else groups.set(id, { ...event });
      }
      events = [...groups.values()];
    }
    if (after)
      events = events.filter(
        (e) => e.observedAt < after.observedAt || (e.observedAt === after.observedAt && e.id < after.id)
      );
    const items = events.slice(0, limit).map((e) => ({ ...e, albumId: albumId(e) }));
    const last = items.at(-1);
    const cursor =
      events.length > limit && last
        ? Buffer.from(JSON.stringify({ coreId, room, kind, asOf, observedAt: last.observedAt, id: last.id })).toString(
            "base64url"
          )
        : undefined;
    return {
      items,
      oldestRetainedAt: retained
        .map((e) => e.observedAt)
        .sort()
        .at(0),
      nextCursor: cursor,
      rooms,
      coreId,
      revision: this.store.snapshot.revision,
      startedAt: this.store.snapshot.startedAt,
      connected: this.recorder.connected,
      status: this.store.error ? "degraded" : this.recorder.connected ? "recording" : "disconnected",
      message: this.store.error,
    };
  }

  event(id: string) {
    const event = this.store.retained().find((e) => e.id === id && e.coreId === this.recorder.coreId);
    if (!event) throw new Error("This history entry has expired. Refresh the list.");
    return event;
  }
}

let singleton: HistoryService | undefined;
let checkpointTimer: NodeJS.Timeout | undefined;
let cleanupTimer: NodeJS.Timeout | undefined;
export function historyService() {
  singleton ??= new HistoryService(
    new HistoryStore(process.env.HISTORY_FILE || path.join(process.cwd(), "config", "playback-history.json"))
  );
  return singleton;
}
export async function startHistory() {
  const service = historyService();
  await service.store.open();
  let pairedCore: RoonServer | undefined;
  roon.onZones((core, response, body) => {
    // A closed subscription can report after its Core proxy has been revoked,
    // even after a replacement connection has paired. Never inspect that proxy.
    if (core !== pairedCore || !service.recorder.coreId) return;
    if (response === "Unsubscribed") {
      service.recorder.disconnect();
      return;
    }
    service.recorder.receive(service.recorder.coreId, response, body);
  });
  roon.onServerLost(() => {
    pairedCore = undefined;
    service.recorder.disconnect();
  });
  roon.onServerPaired((core) => {
    pairedCore = core;
    service.recorder.pair(core.core_id);
  });
  checkpointTimer = setInterval(() => {
    service.recorder.checkpoint();
  }, 60000);
  cleanupTimer = setInterval(() => {
    void service.store.cleanup();
  }, 3600000);
  checkpointTimer.unref();
  cleanupTimer.unref();
}
export async function stopHistory() {
  clearInterval(checkpointTimer);
  clearInterval(cleanupTimer);
  if (singleton) {
    singleton.recorder.disconnect();
    await singleton.store.save();
  }
}
