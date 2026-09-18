import { CapsuleTrack } from "../ai-service/time-capsule";
import { searchAlbumsInLibrary } from "./roon-utils";

const covers = new Map<string, string>();
let lookups = Promise.resolve<string | null>(null);
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** A serialized, separate browse session cannot reset a user's browsing or playback lookup. */
export function cinemaArtwork(
  zoneId: string,
  tracks: CapsuleTrack[]
): Promise<string | null> {
  const key = JSON.stringify([
    zoneId,
    tracks.map(({ artist, album }) => [artist, album]),
  ]);
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

async function findCover(
  zoneId: string,
  tracks: CapsuleTrack[]
): Promise<string | null> {
  const seen = new Set<string>();
  for (const track of tracks) {
    const album = normalize(track.album);
    const artist = normalize(track.artist);
    if (!album || !artist || seen.has(album)) continue;
    seen.add(album);
    const items = await searchAlbumsInLibrary(
      "cinema-artwork",
      zoneId,
      track.album
    );
    const match = items.find((item) => {
      const title = normalize(item.title);
      const subtitle = normalize(item.subtitle ?? "");
      return (
        item.image_key &&
        (title === album || title.startsWith(album)) &&
        subtitle.includes(artist)
      );
    });
    if (match?.image_key) return match.image_key;
    if (seen.size >= 3) break;
  }
  return null;
}
