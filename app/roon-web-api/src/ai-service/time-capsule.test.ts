import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import {
  capsuleImage,
  capsuleKey,
  commonsCandidate,
  getZoneCapsule,
  photographBefore,
  readCapsule,
  researchedURLs,
  reviewPhotographs,
  setZoneCapsule,
  startCapsule,
  TimeCapsule,
  validateCapsuleRequest,
  validateProgramme,
} from "./time-capsule";

const request = () =>
  validateCapsuleRequest({
    query: "French jazz in the 1960s",
    requestedAt: "2026-09-17T12:00:00Z",
    locale: "en_GB",
    timeZone: "Europe/London",
    tracks: [{ artist: "Test artist", track: "Test track", album: "Test album" }],
  });
const source = "https://example.org/archive";
const scene = {
  title: "A sourced story",
  body: "A brief summary",
  scope: "Context",
  dateLabel: "1962",
  sources: [{ title: "Archive", url: source }],
  trackIndices: [0],
  imageQuery: "",
};

describe("Time Capsule", () => {
  test("keeps arbitrary request context and separates relative dates and selected tracks", () => {
    const original = request();
    expect(original.query).toBe("French jazz in the 1960s");
    expect(capsuleKey(original)).not.toBe(capsuleKey({ ...original, requestedAt: "2026-09-24T12:00:00Z" }));
    expect(capsuleKey(original)).not.toBe(
      capsuleKey({ ...original, tracks: [{ ...original.tracks[0], track: "Another track" }] })
    );
  });
  test("rejects malformed inputs and empty selections", () => {
    expect(() => validateCapsuleRequest(null)).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), requestedAt: "yesterday" })).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), tracks: [null] })).toThrow();
    expect(() => validateCapsuleRequest({ ...request(), tracks: [] })).toThrow();
  });
  test("accepts only actual research URLs, drops unsupported scenes and invalid track mappings", () => {
    const urls = researchedURLs({
      output: [
        { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: source }] }] },
      ],
    });
    const result = validateProgramme(
      {
        title: "Jazz",
        contextLabel: "France · 1960s",
        scenes: [
          { ...scene, trackIndices: [0, -1, 9, 0.5] },
          { ...scene, sources: [{ url: "https://invented.example/fake" }] },
        ],
      },
      urls,
      1
    );
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0].trackIndices).toEqual([0]);
    expect(() => validateProgramme({ scenes: [scene] }, new Set(), 1)).toThrow();
  });
  test("does not accept arbitrary image hosts, missing credits or unsupported licences", () => {
    const info = {
      url: "https://upload.wikimedia.org/a.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
      mime: "image/jpeg",
      width: 1920,
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
        Artist: { value: "<b>Photographer</b>" },
        ImageDescription: { value: "A photograph" },
      },
    };
    expect(commonsCandidate(info)?.credit).toBe("Photographer");
    expect(commonsCandidate(info)?.date).toBe("Date not recorded");
    expect(commonsCandidate({ ...info, thumburl: "https://thumb.wikimedia.org/a.jpg" })).toBeDefined();
    expect(commonsCandidate({ ...info, url: "http://127.0.0.1/private" })).toBeUndefined();
    expect(commonsCandidate({ ...info, extmetadata: {} })).toBeUndefined();
    expect(commonsCandidate({ ...info, width: 399 })).toBeUndefined();
  });

  test("rejects later and uncertain photographic dates rather than trusting model selection", () => {
    for (const date of ["2007-07-01", "Taken on 19 March 2010", "2007", "2007-06", "Date not recorded", "circa 2007"]) {
      expect(photographBefore(date, "2007-06-29")).toBe(false);
    }
    for (const date of ["2007-06-29", "2007-06-01 13:00:00", "2006", "2007-05", "Taken on 19 March 2007"]) {
      expect(photographBefore(date, "2007-06-29")).toBe(true);
    }
    expect(photographBefore("Date not recorded")).toBe(true);
  });

  test("keeps montage headlines inside the exact requested window", () => {
    const programme = validateProgramme(
      {
        periodStart: "1984-05-06",
        periodEnd: "1984-05-12",
        scenes: [
          { ...scene, eventStart: "1984-05-08", eventEnd: "1984-05-08" },
          { ...scene, eventStart: "1983-02-01", eventEnd: "1983-02-01" },
          { ...scene, eventStart: "1984-05-13", eventEnd: "1984-05-13" },
          { ...scene, eventStart: "1984-05-01", eventEnd: "1984-06-01" },
        ],
      },
      new Set([source]),
      1
    );
    expect(programme.periodStart).toBe("1984-05-06");
    expect(programme.periodEnd).toBe("1984-05-12");
    expect(programme.scenes).toHaveLength(1);
    expect(() =>
      validateProgramme({ periodStart: "1985-01-01", periodEnd: "1984-01-01", scenes: [scene] }, new Set([source]), 1)
    ).toThrow();
    expect(
      validateProgramme({ periodStart: "1984-02-31", scenes: [scene] }, new Set([source]), 1).periodStart
    ).toBeUndefined();
  });

  test("pixel review removes rejected photos and their legacy fallback", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-review-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const photos = ["a", "b"].map((letter) => ({
      file: letter.repeat(64),
      sourceUrl: source,
      credit: "Archive",
      license: "Public domain",
      licenseUrl: "",
      date: "1962",
      description: "Archive photograph",
    }));
    const capsule: TimeCapsule = {
      id: "c".repeat(64),
      title: "Test",
      contextLabel: "Test",
      createdAt: "",
      request: request(),
      scenes: photos.map((image, index) => ({ ...scene, id: `scene-${index}`, images: [image], image })),
    };
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    acceptedPhotoIds: [photos[0].file, "invented"],
                  }),
                },
              ],
            },
          ],
        })
      )
    );
    try {
      for (const photo of photos)
        await fs.writeFile(path.join(directory, `${photo.file}.image`), Buffer.from([0x89, 1, 2]));
      await reviewPhotographs(capsule);
      expect(capsule.scenes[0].images).toEqual([photos[0]]);
      expect(capsule.scenes[1].images).toEqual([]);
      expect(capsule.scenes[1].image).toBeUndefined();
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as {
        input: { content: { type: string }[] }[];
      };
      expect(body.input[0].content.filter((part) => part.type === "input_image")).toHaveLength(2);
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test("generates from retrieved evidence, persists replay and shares a zone without another AI call", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    delete process.env.OPENAI_API_KEY;
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("saved-test-key");
    const response = (value: unknown) => ({ ok: true, json: () => Promise.resolve(value) }) as Response;
    const output = (value: unknown) =>
      response({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
      });
    let modelCalls = 0;
    let noPictures = false;
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation((input, options) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("api.openai.com")) {
        modelCalls++;
        const stage = modelCalls % 5;
        if (stage === 1)
          return Promise.resolve(
            response({
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: "Retrieved research",
                      annotations: [{ type: "url_citation", url: source }],
                    },
                  ],
                },
              ],
            })
          );
        if (stage === 2)
          return Promise.resolve(
            output({ title: "French jazz", contextLabel: "France · 1960s", scenes: [scene, scene, scene] })
          );
        if (stage === 3) return Promise.resolve(output({ queries: noPictures ? [] : ["French jazz"] }));
        if (stage === 0) {
          const body = JSON.parse(options?.body as string) as {
            input: { content: { type: string; text?: string }[] }[];
          };
          const ids = body.input[0].content
            .filter((part) => part.type === "input_text")
            .map((part) => (JSON.parse(part.text ?? "{}") as { photoId: string }).photoId);
          return Promise.resolve(output({ acceptedPhotoIds: ids }));
        }
        const body = JSON.parse(options?.body as string) as { input: string };
        const payload = JSON.parse(body.input.split("\n").slice(1).join("\n")) as { candidates: { photoId: string }[] };
        const ids = payload.candidates.map((candidate) => candidate.photoId);
        // Return out of order with duplicate and invalid references: association must use IDs.
        return Promise.resolve(
          output({
            matches: [
              { sceneId: "scene-2", photoIds: [ids[2]] },
              { sceneId: "invented-scene", photoIds: [ids[0]] },
              { sceneId: "scene-0", photoIds: [ids[0], ids[0], "invented-photo"] },
              { sceneId: "scene-1", photoIds: [ids[1], ids[0]] },
            ],
          })
        );
      }
      if (url.includes("commons.wikimedia.org/w/api.php"))
        return Promise.resolve(
          response({
            query: {
              pages: Object.fromEntries(
                [0, 1, 2].map((index) => [
                  String(index),
                  {
                    imageinfo: [
                      {
                        url: `https://upload.wikimedia.org/${index}.png`,
                        thumburl: `https://thumb.wikimedia.org/${index}.png`,
                        descriptionurl: `https://commons.wikimedia.org/wiki/File:${index}.png`,
                        mime: "image/png",
                        width: 1920,
                        extmetadata: {
                          Artist: { value: "Archive" },
                          LicenseShortName: { value: "Public domain" },
                          DateTimeOriginal: { value: "1962" },
                          ImageDescription: { value: "An archive photograph" },
                        },
                      },
                    ],
                  },
                ])
              ),
            },
          })
        );
      if (url === "https://thumb.wikimedia.org/0.png")
        return Promise.resolve(new Response("Rate limited", { status: 429 }));
      return Promise.resolve(
        new Response(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK2kAAAAASUVORK5CYII=",
            "base64"
          ),
          { headers: { "content-type": "image/png" } }
        )
      );
    });
    try {
      const job = await startCapsule(request());
      for (let n = 0; n < 100 && !["ready", "failed"].includes(job.status); n++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(job.status).toBe("ready");
      expect((await readCapsule(job.id))?.request).toEqual(request());
      await setZoneCapsule("living/room", job.id);
      expect((await getZoneCapsule("living/room"))?.id).toBe(job.id);
      expect((await startCapsule(request())).status).toBe("ready");
      expect(modelCalls).toBe(5);
      expect(job.capsule?.scenes.map((scene) => scene.image?.sourceUrl)).toEqual(
        [0, 1, 2].map((index) => `https://commons.wikimedia.org/wiki/File:${index}.png`)
      );
      expect(job.capsule?.scenes.flatMap((scene) => scene.images ?? [])).toHaveLength(3);
      expect(fetchMock).toHaveBeenCalledWith("https://upload.wikimedia.org/0.png", expect.anything());
      const original = await readCapsule(job.id);
      noPictures = true;
      const rebuild = await startCapsule(request(), job.id);
      for (let n = 0; n < 100 && !["ready", "failed"].includes(rebuild.status); n++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(rebuild.status).toBe("failed");
      expect(rebuild.error).toContain("Not enough distinct archive photographs");
      expect(await readCapsule(job.id)).toEqual(original);
      expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer saved-test-key" });
      expect(await capsuleImage("../../secret")).toBeUndefined();
      expect(await readCapsule("../../secret")).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
      keyMock.mockRestore();
      if (oldDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
      else process.env.TIME_CAPSULE_CACHE_DIR = oldDirectory;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
