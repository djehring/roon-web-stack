import { logger } from "@infrastructure";
import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { normalizeArtistName, normalizeString } from "./string-utils";

export function matchAlbumInList(albumsList: { items: Item[] }, track: Track): Item | null {
  const titleMatches = albumsList.items.filter((item) => titlesMatch(item.title, track.album));

  if (titleMatches.length === 0) {
    logger.debug(`FAIL. No matching album title found for: ${track.album}`);
    return null;
  }

  const withArtists = titleMatches.filter((item) =>
    albumArtists(item.subtitle).some((artist) => artistsAlign(artist, track.artist))
  );

  if (withArtists.length === 0) {
    logger.debug(`FAIL. No artist on matching albums for: ${track.album}`);
    return null;
  }

  if (withArtists.length === 1) {
    return withArtists[0];
  }

  logger.debug(`Found ${withArtists.length} albums with title "${track.album}". Checking artists...`);

  const normalizedTrackArtist = normalizeArtistName(track.artist);
  const exactArtistMatch = withArtists.find((item) =>
    albumArtists(item.subtitle).some((artist) => normalizeArtistName(artist) === normalizedTrackArtist)
  );
  return exactArtistMatch ?? withArtists[0];
}

function titlesMatch(itemTitle: string, album: string): boolean {
  const normalizedTitle = normalizeString(itemTitle);
  const normalizedAlbum = normalizeString(album);
  if (!normalizedTitle || !normalizedAlbum) return false;
  if (normalizedTitle === normalizedAlbum) return true;
  return normalizedAlbum.endsWith(normalizedTitle) || normalizedTitle.endsWith(normalizedAlbum);
}

function albumArtists(subtitle?: string): string[] {
  if (!subtitle?.trim()) return [];
  const encoded = [...subtitle.matchAll(/\[\[\d+\|(.*?)\]\]/g)].map((match) => match[1]).filter(Boolean);
  if (encoded.length > 0) return encoded;
  return [subtitle];
}

function artistsAlign(albumArtist: string, trackArtist: string): boolean {
  const album = normalizeArtistName(albumArtist);
  const track = normalizeArtistName(trackArtist);
  if (!album || !track) return false;
  return (
    album === track ||
    album.includes(track) ||
    track.includes(album) ||
    album.replace(/[^\w\s]/g, "") === track.replace(/[^\w\s]/g, "")
  );
}
