import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clientManager } from "@service";
import { browseCinemaMusic, performMusicAction } from "../service/cinema-music";
import { HistoryService } from "../service/history/service";
import { HistoryStore } from "../service/history/store";
import { registerHistoryRoutes } from "./history-route";

jest.mock("@service", () => ({ clientManager: { get: jest.fn() } }));
jest.mock("@infrastructure", () => ({ roon: {} }));
jest.mock("../service/cinema-music", () => ({ browseCinemaMusic: jest.fn(), performMusicAction: jest.fn() }));

test("history routes require pairing, validate input, resolve without playback and preserve explicit actions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "history-api-"));
  const service = new HistoryService(new HistoryStore(path.join(directory, "history.json")));
  await service.store.open();
  service.recorder.pair("core");
  service.store.add({
    id: "event",
    coreId: "core",
    title: "Song",
    artist: "Artist",
    album: "Album",
    duration: 120,
    zoneId: "room",
    room: "Room",
    outputIds: [],
    observedAt: new Date().toISOString(),
    qualifiedAt: new Date().toISOString(),
  });
  const app = Fastify();
  jest.mocked(clientManager.get).mockImplementation((id) => {
    if (id !== "paired") throw new Error("Unpaired");
    return {} as never;
  });
  await registerHistoryRoutes(app, service);
  try {
    expect((await app.inject("/unknown/history/tracks")).statusCode).toBe(403);
    expect((await app.inject("/paired/history/capabilities")).json<{ retentionDays: number }>().retentionDays).toBe(14);
    expect((await app.inject("/paired/history/tracks?limit=201")).statusCode).toBe(400);
    expect((await app.inject("/paired/history/tracks?cursor=garbage")).statusCode).toBe(400);
    expect((await app.inject("/paired/history/tracks")).json<{ items: unknown[] }>().items).toHaveLength(1);
    jest.mocked(browseCinemaMusic).mockResolvedValue({
      title: "Tracks",
      kind: "list",
      path: { hierarchy: "search", steps: [] },
      items: [
        {
          title: "Song",
          subtitle: "Artist",
          kind: "track",
          path: { hierarchy: "search", steps: [{ title: "Song", index: 0 }] },
        },
        {
          title: "Song",
          subtitle: "Artist (live)",
          kind: "track",
          path: { hierarchy: "search", steps: [{ title: "Song", index: 1 }] },
        },
      ],
    });
    const resolved = await app.inject({
      method: "POST",
      url: "/paired/history/resolve",
      payload: { eventId: "event", kind: "tracks" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<{ choices: unknown[] }>().choices).toHaveLength(2);
    expect(performMusicAction).not.toHaveBeenCalled();
    expect(
      (await app.inject({ method: "POST", url: "/paired/history/play", payload: { action: "Delete" } })).statusCode
    ).toBe(400);
    expect(performMusicAction).not.toHaveBeenCalled();
    const musicPath = { hierarchy: "albums", steps: [{ title: "Album", index: 0 }] };
    const played = await app.inject({
      method: "POST",
      url: "/paired/history/play",
      payload: { path: musicPath, action: "Queue", zoneId: "destination" },
    });
    expect(played.statusCode).toBe(200);
    expect(performMusicAction).toHaveBeenCalledWith(musicPath, "destination", "Queue");
  } finally {
    await app.close();
    await service.store.save();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
