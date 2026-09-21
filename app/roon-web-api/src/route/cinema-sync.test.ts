import Fastify, { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clientManager } from "@service";
import { PersonalCinema } from "../ai-service/personal-cinema";
import { registerTimeCapsuleRoutes } from "./time-capsule-route";

jest.mock("@service", () => ({ clientManager: { get: jest.fn() } }));
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0xff, 0xd9]);
const file = createHash("sha256").update(jpeg).digest("hex");
function manifest() {
  return {
    id: `personal-${randomUUID()}`,
    title: "Holiday",
    contextLabel: "Personal montage",
    createdAt: new Date().toISOString(),
    originDeviceName: "Kitchen iPad",
    request: {
      query: "Holiday",
      requestedAt: new Date().toISOString(),
      locale: "en_GB",
      timeZone: "Europe/London",
      tracks: [
        { artist: "Artist", track: "Song", album: "Album", entryId: "first" },
        { artist: "Artist", track: "Song", album: "Album", entryId: "repeat" },
      ],
      options: {
        mode: "photos",
        subject: "My photos",
        topics: [],
        region: "GB",
        workContext: "composition",
        captions: "none",
        showTrackTitle: true,
        motion: "kenBurns",
        pace: "relaxed",
        order: "curated",
      },
    },
    scenes: [
      {
        id: "first",
        title: "Photo 1",
        image: { file, localFile: `${randomUUID()}.jpg`, date: "2026-01-01", sourceUrl: "roon-photo://personal" },
      },
    ],
  };
}
describe("Cinema cross-device sharing", () => {
  let app: FastifyInstance, directory: string, previousDirectory: string | undefined;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-sync-"));
    previousDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    jest.mocked(clientManager.get).mockImplementation((id) => {
      if (id === "unpaired") throw new Error("Unpaired");
      return {} as ReturnType<typeof clientManager.get>;
    });
    app = Fastify();
    await registerTimeCapsuleRoutes(app);
  });
  afterEach(async () => {
    await app.close();
    if (previousDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previousDirectory;
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function upload(client = "phone") {
    return app.inject({
      method: "PUT",
      url: `/${client}/time-capsules/personal/images/${file}`,
      headers: { "content-type": "image/jpeg" },
      payload: jpeg,
    });
  }
  test("a second paired device discovers the complete saved setup and downloads identical pictures", async () => {
    const capsule = manifest();
    const payload = { capsule, baseRevision: null, mutationId: randomUUID() };
    expect((await upload()).statusCode).toBe(204);
    const saved = await app.inject({ method: "PUT", url: `/phone/time-capsules/personal/${capsule.id}`, payload });
    expect(saved.statusCode).toBe(200);
    const list = (await app.inject("/tv/time-capsules/")).json<PersonalCinema[]>();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: capsule.id,
      request: capsule.request,
      originDeviceName: capsule.originDeviceName,
      revision: 1,
    });
    expect(list[0].scenes[0].image?.file).toBe(file);
    expect((await app.inject(`/tv/time-capsules/images/${file}`)).rawPayload).toEqual(jpeg);
    expect((await app.inject(`/tv/time-capsules/${capsule.id}`)).json()).toEqual(list[0]);
    expect((await app.inject("/unpaired/time-capsules/")).statusCode).toBe(403);
    expect((await upload("unpaired")).statusCode).toBe(403);
    expect((await app.inject(`/unpaired/time-capsules/images/${file}`)).statusCode).toBe(403);
    const retry = await app.inject({ method: "PUT", url: `/phone/time-capsules/personal/${capsule.id}`, payload });
    expect(retry.json<PersonalCinema>().revision).toBe(1);
  });
  test("missing resources, invalid uploads and stale edits never replace the shared version", async () => {
    const capsule = manifest();
    const url = `/phone/time-capsules/personal/${capsule.id}`;
    const payload = { capsule, baseRevision: null, mutationId: randomUUID() };
    expect((await app.inject({ method: "PUT", url, payload })).statusCode).toBe(400);
    expect((await app.inject("/tv/time-capsules/")).json()).toEqual([]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/phone/time-capsules/personal/images/${"0".repeat(64)}`,
          headers: { "content-type": "image/jpeg" },
          payload: jpeg,
        })
      ).statusCode
    ).toBe(400);
    await upload();
    await app.inject({ method: "PUT", url, payload });
    const edit = { capsule: { ...capsule, title: "Updated on TV" }, baseRevision: 1, mutationId: randomUUID() };
    expect((await app.inject({ method: "PUT", url, payload: edit })).json<PersonalCinema>().revision).toBe(2);
    expect((await app.inject({ method: "PUT", url, payload: { ...edit, mutationId: randomUUID() } })).statusCode).toBe(
      409
    );
    expect((await app.inject(`/tv/time-capsules/${capsule.id}`)).json<PersonalCinema>().title).toBe("Updated on TV");
    expect((await app.inject({ method: "DELETE", url: `/tv/time-capsules/${capsule.id}` })).statusCode).toBe(204);
    expect((await app.inject("/phone/time-capsules/")).json()).toEqual([]);
    expect((await app.inject({ method: "PUT", url, payload })).statusCode).toBe(409);
  });
  test("all generated cinemas are listed beyond the former 50 item limit", async () => {
    await Promise.all(
      Array.from({ length: 55 }, async (_, index) => {
        const id = createHash("sha256").update(String(index)).digest("hex");
        await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify({ ...manifest(), id }));
      })
    );
    expect((await app.inject("/tv/time-capsules/")).json()).toHaveLength(55);
  });
});
