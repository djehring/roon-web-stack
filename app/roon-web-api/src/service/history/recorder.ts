import { randomUUID } from "node:crypto";
import type { RoonApiTransportZones, RoonSubscriptionResponse, Zone } from "@model";
import { HistoryCheckpoint, HistoryEvent, historyLimits, text } from "./model";
import { HistoryStore } from "./store";

interface Session extends HistoryCheckpoint {
  elapsed: number;
  monotonic: number;
  state: string;
  committed: boolean;
  connected: boolean;
}
export class HistoryRecorder {
  coreId?: string;
  connected = false;
  private sessions = new Map<string, Session>();
  constructor(
    readonly store: HistoryStore,
    private readonly wall = Date.now,
    private readonly clock = () => performance.now()
  ) {}

  receive(coreId: string, response: RoonSubscriptionResponse, body: RoonApiTransportZones) {
    this.pair(coreId);
    if (response === "Unsubscribed") {
      this.disconnect();
      return;
    }
    this.connected = true;
    if (response === "Subscribed") {
      this.sessions.forEach((s) => {
        s.connected = false;
      });
      (body.zones ?? []).forEach((z) => {
        this.observe(z);
      });
    }
    for (const id of body.zones_removed ?? []) {
      const session = this.sessions.get(id);
      if (session) session.connected = false;
    }
    for (const zone of [...(body.zones_added ?? []), ...(body.zones_changed ?? [])]) this.observe(zone);
    for (const seek of body.zones_seek_changed ?? []) {
      const session = this.sessions.get(seek.zone_id);
      if (session) this.advance(session, seek.seek_position, session.state);
    }
    for (const [id, session] of this.sessions) {
      if (session.seenAt < this.wall() - 300000 && !session.connected) this.sessions.delete(id);
    }
    while (this.sessions.size > historyLimits.sessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  pair(coreId: string) {
    if (this.coreId === coreId) return;
    if (this.coreId) this.disconnect();
    this.sessions.clear();
    this.coreId = coreId;
  }

  private observe(zone: Zone) {
    const playing = zone.now_playing;
    if (!playing?.length || !Number.isFinite(playing.length) || playing.length <= 0 || playing.length > 86400) {
      this.sessions.delete(zone.zone_id);
      return;
    }
    const title = text(playing.three_line.line1 || playing.two_line.line1);
    if (!title) return;
    const signature = JSON.stringify([
      title,
      text(playing.three_line.line2),
      text(playing.three_line.line3),
      playing.length,
      text(playing.image_key),
    ]);
    let session = this.sessions.get(zone.zone_id);
    if (!session || session.signature !== signature) {
      // A removed group can continue on a new zone with an overlapping output.
      const transferred = [...this.sessions.values()].find(
        (s) =>
          !s.connected &&
          s.signature === signature &&
          this.wall() - s.seenAt < 10000 &&
          zone.outputs.some((o) => s.event.outputIds.includes(o.output_id))
      );
      if (transferred) {
        this.sessions.delete(transferred.event.zoneId);
        session = transferred;
      } else {
        session = this.newSession(zone, signature, title);
      }
      this.sessions.set(zone.zone_id, session);
    }
    session.event.zoneId = text(zone.zone_id, 300);
    session.event.room = text(zone.display_name);
    session.event.outputIds = zone.outputs.slice(0, 64).map((o) => text(o.output_id, 300));
    this.advance(session, playing.seek_position ?? zone.seek_position, zone.state);
  }

  private newSession(zone: Zone, signature: string, title: string): Session {
    const p = zone.now_playing;
    if (!p?.length || !this.coreId) throw new Error("Cannot record a track without duration and Core.");
    const position = p.seek_position ?? zone.seek_position ?? 0;
    const saved = this.store.snapshot.checkpoints.find(
      (c) =>
        c.event.coreId === this.coreId &&
        c.event.zoneId === zone.zone_id &&
        c.signature === signature &&
        this.wall() - c.seenAt < 300000 &&
        position >= c.position - 2 &&
        position - c.position <= (this.wall() - c.seenAt) / 1000 + 3
    );
    const event: HistoryEvent = saved
      ? { ...saved.event }
      : {
          id: randomUUID(),
          coreId: this.coreId,
          observedAt: new Date(this.wall()).toISOString(),
          qualifiedAt: "",
          zoneId: text(zone.zone_id, 300),
          room: text(zone.display_name),
          outputIds: [],
          title,
          artist: text(p.three_line.line2 ?? p.two_line.line2),
          album: text(p.three_line.line3),
          duration: p.length,
          ...(p.image_key ? { imageKey: text(p.image_key) } : {}),
        };
    return {
      event,
      signature,
      position,
      seenAt: this.wall(),
      monotonic: this.clock(),
      state: zone.state,
      elapsed: 0,
      committed: !!saved,
      connected: false,
    };
  }

  private advance(session: Session, position: number | undefined, state: string) {
    if (position === undefined || !Number.isFinite(position) || position < 0) {
      session.connected = false;
      session.state = state;
      return;
    }
    if (!session.committed && session.elapsed === 0 && session.state !== "playing" && state === "playing") {
      session.event.observedAt = new Date(this.wall()).toISOString();
    }
    const elapsed = Math.max(0, (this.clock() - session.monotonic) / 1000);
    const delta = position - session.position;
    // A natural end-to-start transition is evidence of a repeat. A plain backwards seek isn't.
    const wrapped =
      session.connected &&
      session.state === "playing" &&
      state === "playing" &&
      session.position >= session.event.duration - 2 &&
      position <= 2 &&
      elapsed >= session.event.duration - session.position &&
      elapsed <= 5;
    if (wrapped) {
      session.event = {
        ...session.event,
        id: randomUUID(),
        observedAt: new Date(this.wall()).toISOString(),
        qualifiedAt: "",
      };
      session.elapsed = 0;
      session.committed = false;
    } else if (session.connected && session.state === "playing" && elapsed <= 10 && delta > 0 && delta <= elapsed + 2) {
      session.elapsed += Math.min(delta, elapsed);
    }
    session.position = position;
    session.monotonic = this.clock();
    session.seenAt = this.wall();
    session.state = state;
    session.connected = true;
    if (!session.committed && session.elapsed >= Math.min(30, session.event.duration / 2)) {
      session.event.qualifiedAt = new Date(this.wall()).toISOString();
      this.store.add({ ...session.event });
      session.committed = true;
      this.checkpoint();
    }
  }

  checkpoint() {
    this.store.checkpoint(
      [...this.sessions.values()]
        .filter((s) => s.committed)
        .map(({ event, signature, position, seenAt }) => ({ event: { ...event }, signature, position, seenAt }))
    );
  }

  disconnect() {
    this.connected = false;
    this.sessions.forEach((s) => {
      s.connected = false;
    });
    this.checkpoint();
  }
}
