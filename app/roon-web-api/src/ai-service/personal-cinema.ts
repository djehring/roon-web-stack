import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { validateCapsuleOptions } from "./capsule-options";
import { CapsuleConflict, CapsuleImage, CapsuleScene, TimeCapsule, validateCapsuleRequest } from "./time-capsule";

const root = () => process.env.TIME_CAPSULE_CACHE_DIR || path.join(process.cwd(), "cache", "time-capsules");
const uuid = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
export const isPersonalCinema = (id: string) => new RegExp(`^personal-${uuid}$`).test(id);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const locks = new Map<string, Promise<unknown>>();
function locked<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (locks.get(id) ?? Promise.resolve()).then(work, work);
  locks.set(id, next);
  void next
    .finally(() => {
      if (locks.get(id) === next) locks.delete(id);
    })
    .catch(() => undefined);
  return next;
}
async function atomic(file: string, bytes: string | Buffer) {
  await fs.mkdir(root(), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function text(value: unknown, limit = 1000): string {
  if (typeof value !== "string" || value.length > limit) throw new Error("Invalid personal Cinema metadata.");
  return value;
}
type PersonalImage = CapsuleImage & { localFile: string };
export type PersonalCinema = Omit<TimeCapsule, "request"> & {
  request: Omit<TimeCapsule["request"], "options"> & {
    options: Omit<NonNullable<TimeCapsule["request"]["options"]>, "mode"> & { mode: "photos" };
  };
  originDeviceName: string;
  lastMutationId: string;
};

export async function uploadPersonalImage(file: string, bytes: Buffer) {
  if (
    !hash(file) ||
    bytes.length < 4 ||
    bytes.length > 12 * 1024 * 1024 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    createHash("sha256").update(bytes).digest("hex") !== file
  ) {
    throw new Error("Upload a valid Cinema JPEG with its content hash.");
  }
  await atomic(path.join(root(), `${file}.image`), bytes);
}
export async function readPersonalCinema(id: string): Promise<PersonalCinema | undefined> {
  if (!isPersonalCinema(id)) return undefined;
  try {
    return JSON.parse(await fs.readFile(path.join(root(), `${id}.json`), "utf8")) as PersonalCinema;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function listPersonalCinemas(): Promise<PersonalCinema[]> {
  await fs.mkdir(root(), { recursive: true });
  const names = (await fs.readdir(root())).filter(
    (name) => name.endsWith(".json") && isPersonalCinema(name.slice(0, -5))
  );
  const items = await Promise.all(names.map((name) => readPersonalCinema(name.slice(0, -5))));
  return items.filter((item): item is PersonalCinema => !!item);
}
export async function deletePersonalCinema(id: string) {
  if (!isPersonalCinema(id)) throw new Error("Invalid personal Cinema identifier.");
  await locked(id, async () => {
    // A tombstone prevents an offline device or uncertain upload retry resurrecting a deletion.
    await atomic(path.join(root(), `${id}.deleted`), "deleted");
    await fs.rm(path.join(root(), `${id}.json`), { force: true });
  });
}

export async function savePersonalCinema(id: string, body: unknown): Promise<PersonalCinema> {
  if (!isPersonalCinema(id)) throw new Error("Invalid personal Cinema identifier.");
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid personal Cinema metadata.");
    return value as Record<string, unknown>;
  }
  const input = object(body);
  const capsule = object(input.capsule);
  const rawRequest = object(capsule.request);
  const options = object(rawRequest.options);
  const baseRevision = input.baseRevision;
  const mutationId = input.mutationId;
  if (
    capsule.id !== id ||
    (baseRevision !== null &&
      (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0)) ||
    typeof mutationId !== "string" ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(mutationId) ||
    options.mode !== "photos" ||
    !Array.isArray(capsule.scenes) ||
    !capsule.scenes.length ||
    capsule.scenes.length > 200
  ) {
    throw new Error("Provide a personal Cinema, its saved revision and up to 200 photos.");
  }
  // Reuse the existing music/presentation validators; photo mode never enters AI generation.
  const request = validateCapsuleRequest({ ...rawRequest, options: undefined });
  const presentation = validateCapsuleOptions({ ...options, mode: "artwork", topics: ["albumCovers"] });
  function image(value: unknown): PersonalImage {
    const item = object(value);
    if (!hash(item.file) || typeof item.localFile !== "string" || !new RegExp(`^${uuid}\\.jpg$`).test(item.localFile)) {
      throw new Error("A personal Cinema photo is invalid.");
    }
    return {
      file: item.file,
      localFile: item.localFile,
      sourceUrl: "roon-photo://personal",
      credit: "Your photo",
      license: "Personal photo",
      licenseUrl: "",
      date: text(item.date),
      description: "Personal photo",
    };
  }
  const scenes: (CapsuleScene & { image: PersonalImage })[] = capsule.scenes.map((value: unknown) => {
    const scene = object(value);
    if (scene.images !== undefined && (!Array.isArray(scene.images) || scene.images.length !== 1)) {
      throw new Error("A personal Cinema scene is invalid.");
    }
    const photo = image(Array.isArray(scene.images) ? scene.images[0] : scene.image);
    return {
      id: text(scene.id),
      title: text(scene.title),
      body: "",
      dateLabel: "",
      scope: "",
      sources: [],
      trackIndices: [],
      image: photo,
    };
  });
  const createdAt = text(capsule.createdAt, 100);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid Cinema date.");
  const title = text(capsule.title, 200).trim();
  if (!title) throw new Error("Name this Cinema before sharing it.");
  const originDeviceName = text(capsule.originDeviceName, 200);
  return locked(id, async () => {
    const saved = await readPersonalCinema(id);
    if (saved && saved.lastMutationId === mutationId) return saved;
    const deleted = await fs.stat(path.join(root(), `${id}.deleted`)).then(
      () => true,
      () => false
    );
    if (deleted || (saved ? saved.revision !== baseRevision : baseRevision !== null)) {
      throw new CapsuleConflict(
        "This Cinema changed or was deleted on another device. Refresh before syncing your changes."
      );
    }
    for (const scene of scenes) {
      try {
        await fs.access(path.join(root(), `${scene.image.file}.image`));
      } catch {
        throw new Error("Upload all Cinema pictures before sharing the playlist.");
      }
    }
    const result: PersonalCinema = {
      id,
      title,
      contextLabel: "Personal montage",
      createdAt,
      scenes,
      request: { ...request, options: { ...presentation, mode: "photos", topics: [] } },
      originDeviceName: saved?.originDeviceName ?? originDeviceName,
      revision: (saved?.revision ?? 0) + 1,
      lastMutationId: mutationId,
    };
    await atomic(path.join(root(), `${id}.json`), JSON.stringify(result));
    return result;
  });
}
