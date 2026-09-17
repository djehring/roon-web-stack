import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { normalizeArtistName, normalizeString } from "./string-utils";

/** Compare whole artist credits, never words or substrings in a tribute album title. */
export function matchesArtist(requested: string, listed?: string): boolean {
  if (!requested || !listed) return false;
  const plain = (value: string) => value.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, "$1");
  const artist = normalizeArtistName(plain(requested));
  if (!artist) return false;
  if (normalizeArtistName(plain(listed)) === artist) return true;

  // Roon supplies individual linked credits for collaborations. Decode them before
  // normalizing: normalizeString removes square-bracketed text entirely.
  const links = [...listed.matchAll(/\[\[[^|\]]+\|([^\]]+)\]\]/g)].map((match) => match[1]);
  const credits = links.length ? links : listed.split(/\s*(?:,|&|;|\bfeat\.?|\bfeaturing|\band\b)\s*/i);
  return credits.some((credit) => normalizeArtistName(credit) === artist);
}

export function matchesTrackTitle(requested: string, listed: string): boolean {
  const compact = (value: string) => normalizeString(value).replace(/[\s'"-]/g, "");
  const title = compact(requested);
  return !!title && title === compact(listed);
}

export function matchAlbumInList(albumsList: { items: Item[] }, track: Track): Item | null {
  const album = normalizeString(track.album);
  if (!album) return null;
  const titled = albumsList.items.filter((item) => !!item.item_key && albumTitlesMatch(item.title, track.album));
  return (
    titled.find((item) => matchesArtist(track.artist, item.subtitle)) ??
    // Compilations are candidates only: their tracks must verify the performer.
    titled.find((item) => matchesArtist("Various Artists", item.subtitle)) ??
    null
  );
}

export function matchTrackInList(items: Item[], track: Track, albumArtist?: string): Item | undefined {
  return items.find((item) => {
    if (!item.item_key || item.hint === "action" || item.input_prompt || !matchesTrackTitle(track.track, item.title)) {
      return false;
    }
    if (item.subtitle?.trim()) return matchesArtist(track.artist, item.subtitle);
    // Only inherit a missing track credit from an album credited to this artist.
    // A compilation or an unknown artist must never establish recording identity.
    return !matchesArtist("Various Artists", albumArtist) && matchesArtist(track.artist, albumArtist);
  });
}

function albumTitlesMatch(itemTitle: string, album: string): boolean {
  const normalizedTitle = normalizeString(itemTitle);
  const normalizedAlbum = normalizeString(album);
  if (!normalizedTitle || !normalizedAlbum) return false;
  if (normalizedTitle === normalizedAlbum) return true;
  return normalizedAlbum.endsWith(normalizedTitle) || normalizedTitle.endsWith(normalizedAlbum);
}
