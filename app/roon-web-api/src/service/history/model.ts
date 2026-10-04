import { createHash } from "node:crypto";

export const historyLimits = { days: 14, events: 10000, bytes: 16 * 1024 * 1024, sessions: 256 };
export const retentionMs = historyLimits.days * 86400000;
export interface HistoryEvent {
  id: string;
  coreId: string;
  observedAt: string;
  qualifiedAt: string;
  zoneId: string;
  room: string;
  outputIds: string[];
  title: string;
  artist: string;
  album: string;
  duration: number;
  imageKey?: string;
}
export interface HistoryCheckpoint {
  event: HistoryEvent;
  signature: string;
  position: number;
  seenAt: number;
}
export interface HistorySnapshot {
  version: 1;
  startedAt: string;
  revision: number;
  events: HistoryEvent[];
  checkpoints: HistoryCheckpoint[];
}
export const displayText = (value: string) =>
  value.replace(/\[\[([^\]]*)\]\]/g, (_match: string, inner: string) => inner.split("|").at(-1) ?? inner);
export const normalize = (text: string) => displayText(text).normalize("NFKC").trim().toLowerCase();
export const albumId = (event: HistoryEvent) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        event.coreId,
        normalize(event.album),
        // Transport credits describe the track, so composers/guests must not split
        // an album with matching title and artwork. Neither hint proves an edition.
        event.imageKey ? ["artwork", event.imageKey] : ["credits", normalize(event.artist)],
      ])
    )
    .digest("hex");

/** Shared display credits are a label, not a claim of verified album-artist identity. */
export function sharedCredits(latest: string, earlier: string): string {
  const credits = new Set(earlier.split(" / ").map(normalize));
  return latest
    .split(" / ")
    .filter((credit) => credits.has(normalize(credit)))
    .join(" / ");
}
export const order = (a: HistoryEvent, b: HistoryEvent) =>
  b.observedAt.localeCompare(a.observedAt) || b.id.localeCompare(a.id);
export const text = (value: unknown, limit = 1000): string =>
  typeof value === "string" ? displayText(value).slice(0, limit).trim() : "";

export function validEvent(value: unknown): value is HistoryEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as HistoryEvent;
  return (
    [e.id, e.coreId, e.observedAt, e.qualifiedAt, e.zoneId, e.room, e.title, e.artist, e.album].every(
      (v) => typeof v === "string" && v.length <= 1000
    ) &&
    !!e.id &&
    !!e.coreId &&
    !!e.title &&
    !!e.zoneId &&
    Number.isFinite(Date.parse(e.observedAt)) &&
    Number.isFinite(Date.parse(e.qualifiedAt)) &&
    Number.isFinite(e.duration) &&
    e.duration > 0 &&
    e.duration <= 86400 &&
    Array.isArray(e.outputIds) &&
    e.outputIds.length <= 64 &&
    e.outputIds.every((v) => typeof v === "string" && v.length <= 300) &&
    (e.imageKey === undefined || (typeof e.imageKey === "string" && e.imageKey.length <= 1000))
  );
}
