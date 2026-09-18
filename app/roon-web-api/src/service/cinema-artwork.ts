import { randomUUID } from "node:crypto";
import type { CapsuleTrack } from "../ai-service/time-capsule";
import { zoneManager } from "../data/zone-manager";
import { roon } from "../infrastructure/roon-extension";
import { searchAlbumsInLibrary } from "./roon-utils";

const covers = new Map<string, string>();
let lookups = Promise.resolve<string | null>(null);
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

async function bounded<T>(work: Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          resolve(undefined);
        }, 8_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Use the library's own cover, without changing the room's queue or transport. */
export async function cinemaAlbumCover(track: CapsuleTrack) {
  const zoneId = zoneManager.zones()[0]?.zone_id;
  if (!zoneId) return undefined;
  const imageKey = await cinemaArtwork(zoneId, [track]);
  if (!imageKey) return undefined;
  const result = await bounded(
    roon.getImage(imageKey, { format: "image/jpeg", width: 1600, height: 1600, scale: "fit" })
  );
  if (
    !result ||
    result.content_type !== "image/jpeg" ||
    result.image.length < 12 ||
    result.image.length > 8 * 1024 * 1024 ||
    result.image[0] !== 0xff ||
    result.image[1] !== 0xd8
  )
    return undefined;
  return { imageKey, image: result.image };
}

/** A serialized, separate browse session cannot reset a user's browsing or playback lookup. */
export function cinemaArtwork(zoneId: string, tracks: CapsuleTrack[]): Promise<string | null> {
  const key = JSON.stringify([zoneId, tracks.map(({ artist, album }) => [artist, album])]);
  const result = lookups.then(async () => {
    const cached = covers.get(key);
    if (cached) return cached;
    const image = await findCover(zoneId, tracks);
    if (image) {
      if (covers.size >= 64) covers.clear();
      covers.set(key, image);
    }
    return image;
  });
  lookups = result.catch(() => null);
  return lookups;
}

async function findCover(zoneId: string, tracks: CapsuleTrack[]): Promise<string | null> {
  const seen = new Set<string>();
  for (const track of tracks) {
    const album = normalize(track.album);
    const artist = normalize(track.artist);
    const identity = JSON.stringify([artist, album]);
    if (!album || !artist || seen.has(identity)) continue;
    seen.add(identity);
    // A timed-out browse may still finish in Roon. Give it its own session so
    // late responses cannot corrupt the next lookup's browse stack.
    const items = await bounded(searchAlbumsInLibrary(`cinema-artwork-${randomUUID()}`, zoneId, track.album));
    if (!items) return null;
    const match = items.find((item) => {
      const title = normalize(item.title);
      const subtitle = normalize(item.subtitle ?? "");
      const edition =
        title.startsWith(`${album} `) &&
        /^(?:deluxe|expanded|remaster(?:ed)?|super deluxe|anniversary|\d+(?:st|nd|rd|th) anniversary)\b/.test(
          title.slice(album.length + 1)
        );
      return item.image_key && (title === album || edition) && ` ${subtitle} `.includes(` ${artist} `);
    });
    if (match?.image_key) return match.image_key;
    if (seen.size >= 3) break;
  }
  return null;
}
