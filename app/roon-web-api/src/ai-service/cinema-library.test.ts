import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openaiKeyStore } from "../service/openai-key-store";
import { validateCapsuleOptions } from "./capsule-options";
import {
  CapsuleConflict,
  capsuleJob,
  capsuleKey,
  deleteCapsule,
  getZoneCapsule,
  readCapsule,
  setZoneCapsule,
  startCapsule,
  TimeCapsule,
  updateCapsule,
  validateCapsuleRequest,
} from "./time-capsule";

const options = () =>
  validateCapsuleOptions({
    mode: "period",
    topics: ["headlines"],
    subject: "September 1976",
    region: "GB",
    workContext: "composition",
    captions: "brief",
    motion: "gentle",
    pace: "standard",
    order: "curated",
  });

describe("Cinema library lifecycle", () => {
  let directory: string;
  let previousDirectory: string | undefined;
  let original: TimeCapsule;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cinema-library-"));
    previousDirectory = process.env.TIME_CAPSULE_CACHE_DIR;
    process.env.TIME_CAPSULE_CACHE_DIR = directory;
    const request = validateCapsuleRequest({
      query: "September 1976",
      requestedAt: "2026-09-18T12:00:00Z",
      tracks: [{ artist: "Original artist", track: "Original song", album: "Original album" }],
      options: options(),
    });
    original = {
      id: capsuleKey(request),
      title: "September 1976",
      contextLabel: "UK",
      request,
      createdAt: "2026-09-18T12:00:00Z",
      periodStart: "1976-09-01",
      periodEnd: "1976-09-30",
      scenes: [],
    };
    await fs.writeFile(path.join(directory, `${original.id}.json`), JSON.stringify(original));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (previousDirectory === undefined) delete process.env.TIME_CAPSULE_CACHE_DIR;
    else process.env.TIME_CAPSULE_CACHE_DIR = previousDirectory;
    await fs.rm(directory, { recursive: true, force: true });
  });
  test("deletes a saved item, draft and its room association without deleting shared images or another room", async () => {
    const other = { ...original, id: "b".repeat(64) };
    await fs.writeFile(path.join(directory, `${other.id}.json`), JSON.stringify(other));
    await setZoneCapsule("Living Room", original.id);
    await setZoneCapsule("Kitchen", other.id);
    await fs.writeFile(path.join(directory, `draft-${original.id}.json`), "{}");
    await fs.writeFile(path.join(directory, "shared.image"), "image bytes");
    await deleteCapsule(original.id);
    expect(await readCapsule(original.id)).toBeUndefined();
    expect(await capsuleJob(original.id)).toBeUndefined();
    expect(await getZoneCapsule("Living Room")).toBeUndefined();
    expect((await getZoneCapsule("Kitchen"))?.id).toBe(other.id);
    expect(await fs.readFile(path.join(directory, "shared.image"), "utf8")).toBe("image bytes");
    expect(await fs.readdir(directory)).not.toContain(`draft-${original.id}.json`);
    await expect(deleteCapsule(original.id)).resolves.toBeUndefined();
    await deleteCapsule("../../somewhere");
    expect(await readCapsule(other.id)).toEqual(other);
  });
  test("edits retain the old montage and playlist on failure, reject concurrent edits/deletion and preserve anchored dates", async () => {
    jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    let rejectResearch: (error: Error) => void = () => undefined;
    const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectResearch = reject;
        })
    );
    const changed = { ...options(), pace: "relaxed" as const };
    const job = await updateCapsule(original.id, changed);
    expect(job?.id).toBe(original.id);
    for (let n = 0; n < 100 && !fetchMock.mock.calls.length; n++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(fetchMock).toHaveBeenCalled();
    expect(JSON.stringify(fetchMock.mock.calls[0][1]?.body)).toContain("1976-09-01");
    expect(await readCapsule(original.id)).toEqual(original);
    await expect(deleteCapsule(original.id)).rejects.toBeInstanceOf(CapsuleConflict);
    await expect(updateCapsule(original.id, changed)).rejects.toBeInstanceOf(CapsuleConflict);
    rejectResearch(new Error("Research unavailable"));
    for (let n = 0; n < 100 && job?.status !== "failed"; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(job?.status).toBe("failed");
    const failure = JSON.parse(await fs.readFile(path.join(directory, `job-${original.id}.json`), "utf8")) as {
      status: string;
      error: string;
    };
    expect(failure).toMatchObject({ status: "failed", error: "Research unavailable" });
    expect(await readCapsule(original.id)).toEqual(original);
    await deleteCapsule(original.id);
    expect(await capsuleJob(original.id)).toBeUndefined();
  });
  test("a rebuild reuses a successful montage's sourced scenes when its old draft was removed", async () => {
    jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    original.researchVersion = 6;
    original.scenes = [
      {
        id: "scene-1",
        title: "A verified event",
        body: "Evidence already gathered",
        dateLabel: "1976-09-02",
        scope: "News",
        sources: [{ title: "Archive", url: "https://example.org/verified" }],
        trackIndices: [],
        topic: "headlines",
      },
    ];
    await fs.writeFile(path.join(directory, `${original.id}.json`), JSON.stringify(original));
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stop at picture planning"));
    const job = await startCapsule(original.request, original.id, {
      periodStart: original.periodStart,
      periodEnd: original.periodEnd,
    });
    for (let n = 0; n < 100 && job.status !== "failed"; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(job.error).toBe("Stop at picture planning");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as { instructions: string; tools?: unknown };
    expect(body.instructions).toMatch(/^Return JSON \{searches:/);
    expect(body.tools).toBeUndefined();
    expect(await readCapsule(original.id)).toEqual(original);
  });

  test("new explicit dates are resolved instead of silently preserving the old range", async () => {
    jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stop research"));
    const job = await updateCapsule(original.id, { ...options(), periodStart: "1977-01-01", periodEnd: "1977-01-31" });
    for (let n = 0; n < 100 && job?.status !== "failed"; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    const body = fetchMock.mock.calls[0][1]?.body as string;
    expect(body).toContain("1977-01-01");
    expect(body).not.toContain("1976-09-01");
    expect(await readCapsule(original.id)).toEqual(original);
  });
  test("after restart an old manifest cannot complete an interrupted rebuild, including legacy polling", async () => {
    await deleteCapsule(original.id);
    await fs.writeFile(path.join(directory, `${original.id}.json`), JSON.stringify(original));
    const generation = "interrupted-build";
    await fs.writeFile(path.join(directory, `job-${original.id}.json`), JSON.stringify({ generation }));
    expect(await capsuleJob(original.id, generation)).toMatchObject({
      status: "failed",
      generation,
    });
    expect(await capsuleJob(original.id)).toMatchObject({
      status: "failed",
      generation,
    });
    expect(await readCapsule(original.id)).toEqual(original);
    await deleteCapsule(original.id);
    expect(await fs.readdir(directory)).not.toContain(`job-${original.id}.json`);
  });
  test("a new interrupted build fails promptly and a published generation survives restart", async () => {
    const id = "c".repeat(64);
    expect(await capsuleJob(id, "pending")).toMatchObject({
      status: "failed",
      generation: "pending",
    });
    const completed = { ...original, id, generation: "complete" };
    await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(completed));
    expect(await capsuleJob(id, "complete")).toMatchObject({
      status: "ready",
      capsule: completed,
    });
    expect(await capsuleJob(id, "older")).toMatchObject({
      status: "failed",
      generation: "older",
    });
  });
  test("cached create after deletion cannot return a stale completed job", async () => {
    // startCapsule reads the saved cache without making an AI call.
    expect((await startCapsule(original.request)).status).toBe("ready");
    await deleteCapsule(original.id);
    expect(await readCapsule(original.id)).toBeUndefined();
    expect(await updateCapsule(original.id, options())).toBeUndefined();
  });

  test("a research timeout and its stage remain available after a bridge restart", async () => {
    const id = "e".repeat(64);
    const recorded = {
      id,
      generation: "bowie",
      status: "failed",
      message: "Verifying the research…",
      error:
        "Verifying the research timed out after a retry. Retry picture update to continue from the saved research.",
    };
    await fs.writeFile(path.join(directory, `job-${id}.json`), JSON.stringify(recorded));
    expect(await capsuleJob(id, "bowie")).toEqual(recorded);
    expect(await capsuleJob(id)).toEqual(recorded);
  });

  test("recreating an old request never replays or overwrites its edited playlist", async () => {
    const edited = {
      ...original,
      request: { ...original.request, options: { ...options(), pace: "relaxed" as const } },
    };
    await fs.writeFile(path.join(directory, `${edited.id}.json`), JSON.stringify(edited));
    jest.spyOn(openaiKeyStore, "read").mockReturnValue("test-key");
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stop research"));
    const job = await startCapsule(original.request);
    expect(job.id).not.toBe(edited.id);
    expect(job.status).not.toBe("ready");
    for (let n = 0; n < 100 && job.status !== "failed"; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await readCapsule(edited.id)).toEqual(edited);
    // Once the separate creation finishes, repeated creation still uses its cache.
    const recreated = { ...original, id: job.id };
    await fs.writeFile(path.join(directory, `${recreated.id}.json`), JSON.stringify(recreated));
    expect((await startCapsule(original.request)).capsule).toEqual(recreated);
    expect(await readCapsule(edited.id)).toEqual(edited);
  });
});
