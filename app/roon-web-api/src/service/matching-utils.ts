import { logger } from "@infrastructure";
import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { normalizeArtistName, normalizeString } from "./string-utils";

export function matchAlbumInList(albumsList: { items: Item[] }, track: Track): Item | null {
  const albumMatch = albumsList.items.find((item) => {
    const normalizedTitle = normalizeString(item.title);
    const normalizedAlbum = normalizeString(track.album);

    // Extract artist names from [[id|name]] format and normalize them
    const artistMatches = item.subtitle?.match(/\[\[\d+\|(.*?)\]\]/g) || [];
    if (!artistMatches.length) {
      return false; // No valid artist format found
    }

    const artistNames = artistMatches.map((match) => {
      const artistName = match.match(/\[\[\d+\|(.*?)\]\]/)?.[1] || "";
      return normalizeArtistName(artistName);
    });
    const normalizedTrackArtist = normalizeArtistName(track.artist);

    // Check if any of the normalized artist names match
    const artistMatch = artistNames.some(
      (artist) => artist.includes(normalizedTrackArtist) || normalizedTrackArtist.includes(artist)
    );

    // Log the comparison for debugging
    logger.debug(`Album comparison: "${item.title}" (${item.subtitle}) vs "${track.album}" (${track.artist})`);
    logger.debug(
      `Normalized: "${normalizedTitle}" (${artistNames.join(" & ")}) vs "${normalizedAlbum}" (${normalizedTrackArtist})`
    );
    logger.debug(`Match result: Title=${normalizedTitle === normalizedAlbum}, Artist=${artistMatch}`);

    return normalizedTitle === normalizedAlbum && artistMatch;
  });

  if (!albumMatch) {
    logger.debug(`FAIL. No matching album found for: ${track.album} by ${track.artist}`);
    return null;
  }

  return albumMatch;
}
