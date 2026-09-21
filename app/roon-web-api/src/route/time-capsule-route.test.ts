import Fastify from "fastify";
import { clientManager } from "@service";
import {
  CapsuleConflict,
  capsuleJob,
  deleteCapsule,
  getZoneCapsule,
  listCapsules,
  readCapsule,
  startCapsule,
  updateCapsule,
  updateCinemaContent,
} from "../ai-service/time-capsule";
import { cinemaArtwork } from "../service/cinema-artwork";
import { browseCinemaMusic, captureCinemaQueue, importCinemaMusic } from "../service/cinema-music";
import { registerTimeCapsuleRoutes } from "./time-capsule-route";

jest.mock("../service/cinema-artwork", () => ({ cinemaArtwork: jest.fn() }));
jest.mock("../service/cinema-music", () => ({
  browseCinemaMusic: jest.fn(),
  importCinemaMusic: jest.fn(),
  captureCinemaQueue: jest.fn(),
}));
jest.mock("@service", () => ({ clientManager: { get: jest.fn() } }));
jest.mock("../ai-service/time-capsule", () => ({
  ...jest.requireActual<typeof import("../ai-service/time-capsule")>("../ai-service/time-capsule"),
  capsuleJob: jest.fn(),
  startCapsule: jest.fn(),
  updateCapsule: jest.fn(),
  updateCinemaContent: jest.fn(),
  deleteCapsule: jest.fn(),
  listCapsules: jest.fn(),
  readCapsule: jest.fn(),
  getZoneCapsule: jest.fn(),
}));

describe("Time Capsule routes", () => {
  async function server() {
    const app = Fastify();
    await registerTimeCapsuleRoutes(app);
    return app;
  }
  beforeEach(() => {
    jest.mocked(clientManager.get).mockImplementation(() => ({}) as ReturnType<typeof clientManager.get>);
  });
  test("advertises options support only to paired clients", async () => {
    const app = await server();
    try {
      expect((await app.inject("/paired/time-capsules/capabilities")).json()).toEqual({
        optionsVersion: 2,
        managementVersion: 1,
        musicVersion: 1,
        maxTracks: 1000,
      });
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Not registered");
      });
      expect((await app.inject("/unknown/time-capsules/capabilities")).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  test("music import, browse and queue endpoints require pairing and preserve source selections", async () => {
    const app = await server();
    const path = { hierarchy: "albums" as const, steps: [{ title: "Album", index: 0 }] };
    const tracks = [{ artist: "Artist", track: "Song", album: "Album", entryId: "one" }];
    jest.mocked(importCinemaMusic).mockResolvedValue(tracks);
    jest.mocked(browseCinemaMusic).mockResolvedValue({ title: "Album", kind: "album", path, items: [] });
    jest
      .mocked(captureCinemaQueue)
      .mockResolvedValue({ title: "Room queue", sourceLabel: "Room", tracks, includesCurrent: true });
    try {
      const imported = await app.inject({
        method: "POST",
        url: "/paired/time-capsules/music/import",
        payload: { path, zoneId: "room" },
      });
      expect(imported.json()).toEqual({ tracks });
      expect(importCinemaMusic).toHaveBeenCalledWith(path, "room");
      expect(
        (await app.inject({ method: "POST", url: "/paired/time-capsules/music/browse", payload: { path } })).statusCode
      ).toBe(200);
      expect(
        (await app.inject({ method: "POST", url: "/paired/time-capsules/music/queue", payload: { zoneId: "room" } }))
          .statusCode
      ).toBe(200);
      expect(
        (await app.inject({ method: "POST", url: "/paired/time-capsules/music/queue", payload: {} })).statusCode
      ).toBe(400);
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Unpaired");
      });
      expect(
        (await app.inject({ method: "POST", url: "/unknown/time-capsules/music/import", payload: { path } })).statusCode
      ).toBe(403);
      expect(importCinemaMusic).toHaveBeenCalledTimes(1);
      expect(startCapsule).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("content saves forward their revision and return a conflict without discarding the draft", async () => {
    const app = await server();
    const request = {
      query: "Original",
      requestedAt: "2026-09-21T10:00:00.000Z",
      locale: "en_GB",
      timeZone: "Europe/London",
      title: "Evening",
      tracks: [{ artist: "Artist", track: "Song", album: "Album" }],
    };
    const payload = { request, baseRevision: 2, mutationId: "mutation-1234567890" };
    jest.mocked(updateCinemaContent).mockResolvedValue({ id: "saved", status: "ready" });
    try {
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/saved/content", payload })).statusCode
      ).toBe(200);
      expect(updateCinemaContent).toHaveBeenCalledWith("saved", request, 2, payload.mutationId);
      jest.mocked(updateCinemaContent).mockRejectedValue(new CapsuleConflict("Changed on another device"));
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/saved/content", payload })).statusCode
      ).toBe(409);
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/saved/content", payload: { request } }))
          .statusCode
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  test("resolves artwork without starting a generation and rejects unpaired lookups", async () => {
    jest.mocked(cinemaArtwork).mockResolvedValue("cover-key");
    const app = await server();
    const payload = {
      zoneId: "living",
      tracks: [{ artist: "ABBA", track: "Dancing Queen", album: "Arrival" }],
    };
    try {
      const result = await app.inject({
        method: "POST",
        url: "/paired/time-capsules/artwork",
        payload,
      });
      expect(result.json()).toEqual({ imageKey: "cover-key" });
      expect(cinemaArtwork).toHaveBeenCalledWith("living", payload.tracks);
      expect(startCapsule).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/paired/time-capsules/artwork",
            payload: {},
          })
        ).statusCode
      ).toBe(400);
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Unpaired");
      });
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/unknown/time-capsules/artwork",
            payload,
          })
        ).statusCode
      ).toBe(403);
      expect(cinemaArtwork).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
  test("polling passes the requested generation through to the job lookup", async () => {
    jest.mocked(capsuleJob).mockResolvedValue({
      id: "saved",
      generation: "run-2",
      status: "failed",
      error: "Interrupted",
    });
    const app = await server();
    try {
      const result = await app.inject("/paired/time-capsules/jobs/saved?generation=run-2");
      expect(capsuleJob).toHaveBeenCalledWith("saved", "run-2");
      expect(result.json<{ status: string }>().status).toBe("failed");
    } finally {
      await app.close();
    }
  });
  test("passes the selected topics and presentation to preparation", async () => {
    jest.mocked(startCapsule).mockResolvedValue({ id: "job", status: "researching" });
    const options = {
      mode: "work",
      topics: ["composer", "manuscripts"],
      subject: "Beethoven Symphony No. 6",
      region: "GB",
      workContext: "composition",
      captions: "none",
      motion: "kenBurns",
      pace: "relaxed",
      order: "chronological",
    };
    const app = await server();
    try {
      const result = await app.inject({
        method: "POST",
        url: "/paired/time-capsules/",
        payload: {
          query: "Beethoven Symphony No. 6",
          requestedAt: "2026-09-18T00:00:00Z",
          tracks: [{ artist: "Orchestra", track: "I. Allegro" }],
          options,
        },
      });
      expect(result.statusCode).toBe(202);
      expect(jest.mocked(startCapsule).mock.calls[0][0].options).toEqual(options);
    } finally {
      await app.close();
    }
  });
  test("rejects an unpaired client before returning the saved library", async () => {
    jest.mocked(clientManager.get).mockImplementation(() => {
      throw new Error("Not registered");
    });
    const app = await server();
    try {
      expect((await app.inject("/unknown/time-capsules/")).statusCode).toBe(403);
      expect(listCapsules).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  test("validates requests and returns an asynchronous preparation job", async () => {
    jest.mocked(startCapsule).mockResolvedValue({ id: "job", status: "researching" });
    const app = await server();
    try {
      expect((await app.inject({ method: "POST", url: "/paired/time-capsules/", payload: {} })).statusCode).toBe(400);
      expect(startCapsule).not.toHaveBeenCalled();
      const result = await app.inject({
        method: "POST",
        url: "/paired/time-capsules/",
        payload: {
          query: "Soul from Detroit",
          requestedAt: "2026-01-02T12:00:00Z",
          tracks: [{ artist: "Test artist", track: "Test track" }],
        },
      });
      expect(result.statusCode).toBe(202);
      expect(result.json()).toEqual({ id: "job", status: "researching" });
      expect(jest.mocked(startCapsule).mock.calls[0][0].query).toBe("Soul from Detroit");
    } finally {
      await app.close();
    }
  });
  test("rebuild preserves the original request and saved capsule identity", async () => {
    const request = {
      query: "A historical week",
      requestedAt: "2026-01-02T12:00:00Z",
      locale: "en_GB",
      timeZone: "Europe/London",
      tracks: [],
    };
    jest.mocked(readCapsule).mockResolvedValue({
      id: "saved",
      title: "Week",
      contextLabel: "Week",
      createdAt: "",
      scenes: [],
      request,
      periodStart: "1982-02-14",
      periodEnd: "1982-02-20",
    });
    jest.mocked(startCapsule).mockResolvedValue({ id: "saved", status: "researching" });
    const app = await server();
    try {
      const result = await app.inject({ method: "POST", url: "/paired/time-capsules/saved/rebuild" });
      expect(result.statusCode).toBe(202);
      expect(startCapsule).toHaveBeenCalledWith(request, "saved", {
        periodStart: "1982-02-14",
        periodEnd: "1982-02-20",
      });
    } finally {
      await app.close();
    }
  });
  test("edits only visual options, with paired access and validation", async () => {
    const options = {
      mode: "period",
      topics: ["headlines"],
      subject: "September 1976",
      region: "GB",
      workContext: "composition",
      captions: "brief",
      motion: "gentle",
      pace: "standard",
      order: "curated",
    };
    jest.mocked(updateCapsule).mockResolvedValue({ id: "saved", status: "researching" });
    const app = await server();
    try {
      const result = await app.inject({
        method: "PUT",
        url: "/paired/time-capsules/saved",
        payload: { options, tracks: [{ artist: "Unwanted replacement", track: "Ignore me" }] },
      });
      expect(result.statusCode).toBe(202);
      expect(updateCapsule).toHaveBeenCalledWith("saved", options);
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/saved", payload: { options: {} } })).statusCode
      ).toBe(400);
      jest.mocked(updateCapsule).mockRejectedValue(new CapsuleConflict("Already updating"));
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/saved", payload: { options } })).statusCode
      ).toBe(409);
      jest.mocked(updateCapsule).mockResolvedValue(undefined);
      expect(
        (await app.inject({ method: "PUT", url: "/paired/time-capsules/missing", payload: { options } })).statusCode
      ).toBe(404);
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Not registered");
      });
      expect(
        (await app.inject({ method: "PUT", url: "/unknown/time-capsules/saved", payload: { options } })).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
  test("deletion is paired, idempotent and reports active regeneration", async () => {
    jest.mocked(deleteCapsule).mockResolvedValue(undefined);
    const app = await server();
    try {
      expect((await app.inject({ method: "DELETE", url: "/paired/time-capsules/saved" })).statusCode).toBe(204);
      expect(deleteCapsule).toHaveBeenCalledWith("saved");
      jest.mocked(deleteCapsule).mockRejectedValue(new CapsuleConflict("Wait for regeneration"));
      const busy = await app.inject({ method: "DELETE", url: "/paired/time-capsules/saved" });
      expect(busy.statusCode).toBe(409);
      expect(busy.json<{ error: string }>().error).toBe("Wait for regeneration");
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Not registered");
      });
      expect((await app.inject({ method: "DELETE", url: "/unknown/time-capsules/saved" })).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
  test("a room without an associated capsule returns no content", async () => {
    jest.mocked(getZoneCapsule).mockResolvedValue(undefined);
    const app = await server();
    try {
      expect((await app.inject("/paired/time-capsules/zone/living-room")).statusCode).toBe(204);
      expect(getZoneCapsule).toHaveBeenCalledWith("living-room");
    } finally {
      await app.close();
    }
  });
});
