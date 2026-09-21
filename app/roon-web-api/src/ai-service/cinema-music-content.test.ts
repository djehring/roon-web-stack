import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateCapsuleOptions } from "./capsule-options";
import * as gallery from "./cinema-gallery";
import {
  CapsuleConflict,
  capsuleKey,
  readCapsule,
  TimeCapsule,
  updateCinemaContent,
  validateCapsuleRequest,
} from "./time-capsule";

describe("Cinema music saves", () => {
  let directory: string;
  let previous: string | undefined;
  let original: TimeCapsule;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-music-content-"));
    previous = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const request = validateCapsuleRequest({
      query: "Original context",
      requestedAt: "2026-09-21T10:00:00Z",
      tracks: ["one", "two", "three"].map((entryId) => ({
        artist: "Artist",
        track: "Repeated song",
        album: "Album",
        entryId,
      })),
      options: validateCapsuleOptions({
        mode: "artist",
        subject: "Artist",
        topics: ["artistImages"],
        region: "GB",
        workContext: "composition",
        captions: "brief",
        motion: "still",
        pace: "standard",
        order: "curated",
      }),
    });
    original = {
      id: capsuleKey(request),
      title: "Original",
      contextLabel: "Artist",
      request,
      createdAt: "2026-09-20T10:00:00Z",
      scenes: [
        {
          id: "picture",
          title: "Portrait",
          body: "",
          dateLabel: "",
          scope: "Music",
          sources: [],
          trackIndices: [0, 1, 2],
        },
      ],
    };
    await fs.writeFile(path.join(directory, `${original.id}.json`), JSON.stringify(original));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (previous === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  });

  test("reorders repeated tracks, renames and persists without research or changing the context", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not research"));
    const request = {
      ...original.request,
      title: "Evening",
      tracks: [original.request.tracks[2], original.request.tracks[0]],
    };
    const result = await updateCinemaContent(original.id, request, 0, "mutation-one");
    expect(result?.status).toBe("ready");
    const saved = await readCapsule(original.id);
    if (!saved) throw new Error("Saved item missing");
    expect(saved.request).toEqual(request);
    expect(saved.title).toBe("Evening");
    expect(saved.createdAt).toBe(original.createdAt);
    expect(saved.scenes[0].trackIndices).toEqual([1, 0]);
    expect(saved.revision).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(original.request.tracks).toHaveLength(3);
  });

  test("retries are idempotent and concurrent stale saves cannot overwrite each other", async () => {
    const request = { ...original.request, title: "First edit" };
    const first = await updateCinemaContent(original.id, request, 0, "mutation-one");
    expect(await updateCinemaContent(original.id, request, 0, "mutation-one")).toEqual(first);
    await expect(
      updateCinemaContent(original.id, { ...request, title: "Stale" }, 0, "mutation-two")
    ).rejects.toBeInstanceOf(CapsuleConflict);
    const results = await Promise.allSettled(
      ["A", "B"].map((title) => updateCinemaContent(original.id, { ...request, title }, 1, `mutation-${title}`))
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await readCapsule(original.id))?.revision).toBe(2);
  });

  test("track title and Ken Burns choices persist without fetching or replacing pictures", async () => {
    const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not research"));
    const options = validateCapsuleOptions({
      ...original.request.options,
      showTrackTitle: true,
      motion: "kenBurns",
      captions: "none",
    });
    const result = await updateCinemaContent(original.id, { ...original.request, options }, 0, "presentation");
    expect(result?.status).toBe("ready");
    const saved = await readCapsule(original.id);
    expect(saved?.request.options).toEqual(options);
    expect(saved?.scenes).toEqual(original.scenes);
    expect(saved?.createdAt).toBe(original.createdAt);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("legacy tracks retain scene associations when the editor first assigns occurrence IDs", async () => {
    original.request.tracks.forEach((track) => {
      delete track.entryId;
    });
    await fs.writeFile(path.join(directory, `${original.id}.json`), JSON.stringify(original));
    const request = {
      ...original.request,
      tracks: original.request.tracks.map((track, index) => ({ ...track, entryId: `new-${index}` })),
    };
    const job = await updateCinemaContent(original.id, request, 0, "legacy-edit");
    expect(job?.capsule?.scenes[0].trackIndices).toEqual([0, 1, 2]);
  });

  test("picture completion preserves music edits made while it was running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const covers = jest.spyOn(gallery, "attachRoonAlbumCovers").mockImplementation(async (capsule) => {
      await gate;
      capsule.scenes = [
        {
          id: "cover",
          title: "Album",
          body: "",
          dateLabel: "",
          scope: "Music",
          sources: [],
          trackIndices: [],
          topic: "albumCovers",
          images: [
            {
              file: "cover",
              sourceUrl: "https://example.org/cover",
              credit: "Roon",
              license: "Library",
              licenseUrl: "",
              date: "",
              description: "Album",
            },
          ],
        },
      ];
    });
    if (!original.request.options) throw new Error("Fixture options missing");
    const pictureRequest = {
      ...original.request,
      options: { ...original.request.options, mode: "artwork" as const, topics: ["albumCovers" as const] },
    };
    const job = await updateCinemaContent(original.id, pictureRequest, 0, "pictures-one");
    for (let n = 0; n < 100 && !covers.mock.calls.length; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(covers).toHaveBeenCalled();
    expect(await updateCinemaContent(original.id, pictureRequest, 0, "pictures-one")).toBe(job);
    const musicRequest = {
      ...original.request,
      title: "While pictures load",
      options: { ...original.request.options, showTrackTitle: true, motion: "kenBurns" as const },
      tracks: [original.request.tracks[2], original.request.tracks[0]],
    };
    await updateCinemaContent(original.id, musicRequest, 0, "music-two");
    release();
    for (let n = 0; n < 100 && job?.status !== "ready" && job?.status !== "failed"; n++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(job?.status).toBe("ready");
    const saved = await readCapsule(original.id);
    expect(saved?.request.tracks).toEqual(musicRequest.tracks);
    expect(saved?.title).toBe(musicRequest.title);
    expect(saved?.request.options?.mode).toBe("artwork");
    expect(saved?.request.options?.showTrackTitle).toBe(true);
    expect(saved?.request.options?.motion).toBe("kenBurns");
    expect(saved?.revision).toBe(2);
  });

  test("accepts complete large selections, rejects duplicate occurrence IDs and oversized lists", () => {
    const tracks = Array.from({ length: 1000 }, (_, index) => ({
      ...original.request.tracks[0],
      entryId: `entry-${index}`,
    }));
    expect(validateCapsuleRequest({ ...original.request, tracks }).tracks).toHaveLength(1000);
    expect(() => validateCapsuleRequest({ ...original.request, tracks: [...tracks, tracks[0]] })).toThrow("1–1000");
    expect(() => validateCapsuleRequest({ ...original.request, tracks: [tracks[0], tracks[0]] })).toThrow(
      "unique entry ID"
    );
  });
});
