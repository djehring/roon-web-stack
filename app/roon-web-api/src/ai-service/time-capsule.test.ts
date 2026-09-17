import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import {
  capsuleImage,
  capsuleKey,
  commonsCandidate,
  getZoneCapsule,
  readCapsule,
  researchedURLs,
  setZoneCapsule,
  startCapsule,
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
  });

  test("keeps requested date boundaries and labels earlier context without admitting later events", () => {
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
    expect(programme.scenes).toHaveLength(2);
    expect(programme.scenes[1].scope).toBe("Earlier context");
    expect(() =>
      validateProgramme({ periodStart: "1985-01-01", periodEnd: "1984-01-01", scenes: [scene] }, new Set([source]), 1)
    ).toThrow();
    expect(
      validateProgramme({ periodStart: "1984-02-31", scenes: [scene] }, new Set([source]), 1).periodStart
    ).toBeUndefined();
  });

  test("generates from retrieved evidence, persists replay and shares a zone without another AI call", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-test-"));
    const oldDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    const oldKey = process.env.OPENAI_API_KEY;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    delete process.env.OPENAI_API_KEY;
    const keyMock = jest.spyOn(openaiKeyStore, "read").mockReturnValue("saved-test-key");
    const response = (value: unknown) => ({ ok: true, json: () => Promise.resolve(value) }) as Response;
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
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
      )
      .mockResolvedValueOnce(
        response({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ title: "French jazz", contextLabel: "France · 1960s", scenes: [scene] }),
                },
              ],
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ queries: [] }) }] }],
        })
      );
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
      expect(fetchMock).toHaveBeenCalledTimes(3);
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
