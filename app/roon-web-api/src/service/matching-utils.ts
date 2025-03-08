import { logger } from "@infrastructure";
import { Item } from "@model";
import { Track } from "../ai-service/types/track";
import { normalizeArtistName, normalizeString } from "./string-utils";

export function matchAlbumInList(albumsList: { items: Item[] }, track: Track): Item | null {
  // First, find all albums that match the title
  const titleMatches = albumsList.items.filter((item) => {
    const normalizedTitle = normalizeString(item.title);
    const normalizedAlbum = normalizeString(track.album);
    return normalizedTitle === normalizedAlbum;
  });

  if (titleMatches.length === 0) {
    logger.debug(`FAIL. No matching album title found for: ${track.album}`);
    return null;
  }

  // Check for valid artist format in all title matches
  const validMatches = titleMatches.filter((item) => {
    const artistMatches = item.subtitle?.match(/\[\[\d+\|(.*?)\]\]/g) || [];
    return artistMatches.length > 0; // Only keep items with valid artist format
  });

  if (validMatches.length === 0) {
    logger.debug(`FAIL. No valid artist format found for matching albums for: ${track.album}`);
    return null;
  }

  // If we have multiple valid matches, try to find the best artist match
  if (validMatches.length > 1) {
    logger.debug(`Found ${validMatches.length} albums with title "${track.album}". Checking artists...`);

    const normalizedTrackArtist = normalizeArtistName(track.artist);

    // First, try to find an exact artist match
    const exactArtistMatch = validMatches.find((item) => {
      const artistMatches = item.subtitle?.match(/\[\[\d+\|(.*?)\]\]/g) || [];

      const artistNames = artistMatches.map((match) => {
        const artistName = match.match(/\[\[\d+\|(.*?)\]\]/)?.[1] || "";
        return normalizeArtistName(artistName);
      });

      // Check for exact artist match
      return artistNames.some((artist) => artist === normalizedTrackArtist);
    });

    if (exactArtistMatch) {
      logger.debug(`Found exact artist match: ${exactArtistMatch.subtitle}`);
      return exactArtistMatch;
    }

    // If no exact match, use the flexible matching logic
    const flexibleArtistMatch = validMatches.find((item) => {
      const artistMatches = item.subtitle?.match(/\[\[\d+\|(.*?)\]\]/g) || [];

      const artistNames = artistMatches.map((match) => {
        const artistName = match.match(/\[\[\d+\|(.*?)\]\]/)?.[1] || "";
        return normalizeArtistName(artistName);
      });

      // Use flexible matching
      return artistNames.some(
        (artist) =>
          artist.includes(normalizedTrackArtist) ||
          normalizedTrackArtist.includes(artist) ||
          artist.replace(/[^\w\s]/g, "") === normalizedTrackArtist.replace(/[^\w\s]/g, "") ||
          artist.split(/\s+/).some((word) => word.length > 3 && normalizedTrackArtist.includes(word))
      );
    });

    if (flexibleArtistMatch) {
      logger.debug(`Found flexible artist match: ${flexibleArtistMatch.subtitle}`);
      return flexibleArtistMatch;
    }
  }

  // If we only have one valid match, return it
  return validMatches[0];
}
