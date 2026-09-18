import Fastify from "fastify";
import { clientManager } from "@service";
import { getZoneCapsule, listCapsules, readCapsule, startCapsule } from "../ai-service/time-capsule";
import { registerTimeCapsuleRoutes } from "./time-capsule-route";

jest.mock("@service", () => ({ clientManager: { get: jest.fn() } }));
jest.mock("../ai-service/time-capsule", () => ({
  ...jest.requireActual<typeof import("../ai-service/time-capsule")>("../ai-service/time-capsule"),
  startCapsule: jest.fn(),
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
      expect((await app.inject("/paired/time-capsules/capabilities")).json()).toEqual({ optionsVersion: 2 });
      jest.mocked(clientManager.get).mockImplementation(() => {
        throw new Error("Not registered");
      });
      expect((await app.inject("/unknown/time-capsules/capabilities")).statusCode).toBe(403);
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
