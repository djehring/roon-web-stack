import fs from "fs/promises";
import path from "path";
import { logger, roon } from "@infrastructure";
import {
  Item,
  RoonApiBrowseLoadOptions,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseOptions,
  RoonApiBrowseResponse,
} from "@model";
import { findTrackWithGPT } from "../ai-service/chatgpt";
import { Track } from "../ai-service/types/track";
import { matchAlbumInList } from "./matching-utils";
import { browseIntoLibrary, getLibrarySearchItem, resetBrowseSession, searchForAlbumWithTitle } from "./roon-utils";
import { normalizeArtistName, normalizeString } from "./string-utils";

interface TrackToPlay {
  title: string;
  artist: string;
  image: string;
  itemKey: string;
  zoneId: string;
}

// Directory for storing unmatched tracks data
const UNMATCHED_TRACKS_DIR = path.join(process.cwd(), "data", "unmatched-tracks");

/**
 * Persists unmatched tracks to a JSON file for later analysis
 * @param tracks - Array of unmatched tracks
 */
async function persistUnmatchedTracks(tracks: Track[]): Promise<void> {
  if (!tracks.length) return;

  try {
    // Create directory if it doesn't exist
    await fs.mkdir(UNMATCHED_TRACKS_DIR, { recursive: true });

    // Create a timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(UNMATCHED_TRACKS_DIR, `unmatched-tracks-${timestamp}.json`);

    // Add metadata to help with analysis
    const dataToSave = {
      timestamp: new Date().toISOString(),
      count: tracks.length,
      tracks,
    };

    // Write to file
    await fs.writeFile(filename, JSON.stringify(dataToSave, null, 2));
    logger.info(`Persisted ${tracks.length} unmatched tracks to ${filename}`);
  } catch (error) {
    logger.error(`Failed to persist unmatched tracks: ${JSON.stringify(error)}`);
  }
}

export async function findTracksInRoon(tracks: Track[], browseOptions: RoonApiBrowseOptions): Promise<Track[]> {
  const unmatchedTracks: Track[] = [];
  let startPlay = true;
  const len = tracks.length;
  logger.debug({ len, startPlay }, "Starting track search");
  logger.debug("Received tracks to play:", tracks);

  if (!tracks.length) {
    logger.error("No tracks provided to findTracksInRoon");
    return [];
  }

  for (const track of tracks) {
    try {
      if (!track.artist || !track.track) {
        logger.error("Invalid track data:", track);
        track.error = "Missing artist or track name";
        unmatchedTracks.push(track);
        continue;
      }

      logger.debug({ track, startPlay }, "Processing track");
      await resetBrowseSession(browseOptions.multi_session_key, "search");

      // Try album-based search first (our new primary method)
      if (track.album && track.album.trim() !== "") {
        logger.debug(`Attempting album-based search for "${track.track}" on album "${track.album}"`);
        const foundTrack = await findTrackByAlbum(track, browseOptions);

        if (foundTrack) {
          logger.debug(`Found track via album search: ${foundTrack.title}`);
          try {
            // Use album-specific playback for tracks found via album search
            await playAlbumTrack(foundTrack, browseOptions, startPlay);
            startPlay = false;
            continue;
          } catch (error) {
            logger.error(`Error playing album track ${track.track}: ${JSON.stringify(error)}`);
            // Fall through to direct search if playback fails
          }
        } else {
          logger.debug(`Track "${track.track}" not found on album "${track.album}"`);
          track.error = `Track not found on album "${track.album}"`;
        }
      }

      // After the album search fails, try direct search as fallback
      logger.debug({ track }, "Album search failed or skipped, trying direct search");
      const trackFound = await findTrackInSearchResults(track, browseOptions, startPlay);

      if (trackFound) {
        logger.debug({ track, wasStartPlay: startPlay }, "Track found via direct search");
        startPlay = false;
      } else {
        // Try artist-then-track search as a fallback
        logger.debug({ track }, "Direct search failed, trying artist-then-track search");
        const artistTrackFound = await findTrackByArtistThenTrack(track, browseOptions, startPlay);

        if (artistTrackFound) {
          logger.debug({ track, wasStartPlay: startPlay }, "Track found via artist-then-track search");
          startPlay = false;
        } else {
          // Final fallback: Use GPT to find the correct album
          logger.debug({ track }, "All search methods failed, trying GPT-based album search");

          try {
            // Get album suggestion from GPT
            const updatedTrack = await findTrackWithGPT(track);

            // Only proceed if we got a different album than before
            if (updatedTrack.album && updatedTrack.album !== track.album && updatedTrack.wasAutoCorrected) {
              logger.debug(`GPT suggested album: "${updatedTrack.album}" for track: ${track.track}`);

              // Try album-based search with the updated album information
              await resetBrowseSession(browseOptions.multi_session_key, "search");
              const foundTrack = await findTrackByAlbum(updatedTrack, browseOptions);

              if (foundTrack) {
                logger.debug(`Found track via GPT album search: ${foundTrack.title}`);
                try {
                  // Use album-specific playback for tracks found via GPT album search
                  await playAlbumTrack(foundTrack, browseOptions, startPlay);
                  startPlay = false;
                  continue;
                } catch (error) {
                  logger.error(`Error playing GPT-suggested album track ${track.track}: ${JSON.stringify(error)}`);
                  // Fall through to marking as not found
                }
              } else {
                logger.debug(`Track "${track.track}" not found on GPT-suggested album "${updatedTrack.album}"`);
                // Keep the GPT suggestion in the error message
                track.error = `Track not found on GPT-suggested album "${updatedTrack.album}"`;
                track.album = updatedTrack.album; // Update the album for future reference
                track.wasAutoCorrected = true;
                track.correctionMessage = updatedTrack.correctionMessage;
              }
            } else {
              logger.debug(`GPT did not provide a useful album suggestion for: ${track.track}`);
              if (!track.error) {
                track.error = "Track not found in library";
              }
            }
          } catch (gptError) {
            logger.error(`Error using GPT to find album for ${track.track}: ${JSON.stringify(gptError)}`);
            if (!track.error) {
              track.error = "Track not found in library";
            }
          }

          // Add to unmatched tracks regardless of GPT result
          unmatchedTracks.push(track);
        }
      }
    } catch (error) {
      logger.error(`Error processing track ${track.artist} - ${track.track}: ${JSON.stringify(error)}`);
      track.error = `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      unmatchedTracks.push(track);
    }
  }

  if (unmatchedTracks.length > 0) {
    logger.error("Some tracks were not found:", unmatchedTracks);
    // Persist unmatched tracks for later analysis
    await persistUnmatchedTracks(unmatchedTracks);
  }

  return unmatchedTracks;
}

async function performSearch(track: Track, browseOptions: RoonApiBrowseOptions): Promise<RoonApiBrowseResponse> {
  // Try different search variations
  const searchVariations = [
    track.track, // Just the track name
    `${track.artist} ${track.track}`, // Artist and track
    // Handle parenthetical titles: "Main Title (Theme Name)"
    ...(track.track.includes("(")
      ? [
          track.track.replace(/\s*\([^)]*\)/, "").trim(), // Without parentheses
          track.track.match(/\((.*?)\)/)?.[1]?.trim() ?? "", // Just parenthetical content
        ]
      : []),
    track.track.replace(/^the\s+/i, ""), // Without "the"
    track.track.replace(/\s+theme$/i, ""), // Without "theme"
    // Additional variations for better matching
    track.track.replace(/'/g, ""), // Without apostrophes
    track.track.replace(/\s+/g, " "), // Normalize spaces
    // Handle common word variations
    track.track.replace(/get down/i, "getdown"), // Handle "Get Down" variations
    track.track.replace(/get back/i, "getback"), // Handle "Get Back" variations
    // Try with just the artist name for broader search
    track.artist,
  ].filter(Boolean);

  for (const searchTerm of searchVariations) {
    logger.debug(`Trying search term: ${searchTerm}`);
    const searchOptions = {
      ...browseOptions,
      hierarchy: "search",
      input: searchTerm,
      pop_all: true,
    };

    const response = await roon.browse(searchOptions);
    if (response.list && response.list.count > 0) {
      return response;
    }
  }

  // If all variations fail, return the last response
  return roon.browse({
    ...browseOptions,
    hierarchy: "search",
    input: `${track.artist} ${track.track}`,
    pop_all: true,
  });
}

async function loadSearchResults(client_id?: string): Promise<RoonApiBrowseLoadResponse> {
  const searchLoadOptions: RoonApiBrowseLoadOptions = {
    hierarchy: "search",
    offset: 0,
    count: 5,
    multi_session_key: client_id,
  };
  return roon.load(searchLoadOptions);
}

function createLoadOptions(browseOptions: RoonApiBrowseOptions): RoonApiBrowseLoadOptions {
  return {
    hierarchy: "search",
    multi_session_key: browseOptions.multi_session_key,
  };
}

async function queueSingleTrack(
  track: TrackToPlay,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<void> {
  try {
    const searchOptions = {
      ...browseOptions,
      hierarchy: "search",
      item_key: track.itemKey,
    };

    // Step 1: Navigate to the item using its itemKey
    const headerResult = await roon.browse(searchOptions);
    validateBrowseResponse(headerResult, `Playback requested of unsupported id: ${track.itemKey}`);
    if (headerResult.list?.level === 0) {
      logger.debug(`Auto-playback started for: ${track.title}`);
      return;
    }

    // Step 2: Load the list of items
    const loadResponse = await roon.load(createLoadOptions(browseOptions));
    const queueItem = getPlayableItem(loadResponse, track.itemKey);

    // Step 3: Handle "action_list" hint and execute action
    if (queueItem.hint === "action_list") {
      const actionListItem = await handleActionList(queueItem, track, browseOptions, startPlay);
      if (!actionListItem) {
        throw new Error(`No valid action found for: ${track.title}`);
      }
      await executeAction(actionListItem, track, browseOptions);
    } else if (queueItem.hint === "action") {
      await executeAction(queueItem, track, browseOptions);
    } else {
      throw new Error(`Unsupported item hint for playback. ID: ${track.itemKey}`);
    }
    logger.debug(`Successfully queued: ${track.title} by ${track.artist}`);
  } catch (error) {
    logger.error(`Error in queueSingleTrack for ${track.title}: ${JSON.stringify(error)}`);
    throw error;
  }
}

function validateBrowseResponse(response: RoonApiBrowseResponse, errorMessage: string): void {
  if (!response.list) {
    throw new Error(errorMessage);
  }
}

function getPlayableItem(loadResponse: RoonApiBrowseLoadResponse, itemKey: string): Item {
  const queueItem = loadResponse.items[0];
  if (!queueItem.hint || !["action", "action_list"].includes(queueItem.hint)) {
    throw new Error(`Item is not playable. ID: ${itemKey}`);
  }
  return queueItem;
}

async function handleActionList(
  queueItem: Item,
  track: TrackToPlay,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<Item | null> {
  try {
    const newSearchOptions = {
      hierarchy: "search",
      item_key: queueItem.item_key,
      zone_or_output_id: track.zoneId,
      multi_session_key: browseOptions.multi_session_key,
    };
    const actionListResponse = await roon.browse(newSearchOptions);
    validateBrowseResponse(actionListResponse, `Playback requested of unsupported id: ${track.itemKey}`);

    const actionListLoad = await roon.load({
      hierarchy: "search",
      level: actionListResponse.list?.level,
      multi_session_key: browseOptions.multi_session_key,
    });

    logger.debug(
      `Handling track: ${track.title} by ${track.artist}. Action: ${startPlay ? "play" : "queue"}. Items: ${JSON.stringify(actionListLoad.items)}`
    );

    if (!actionListLoad.items.length) {
      logger.error(`No actions available for: ${track.title}`);
      return null;
    }

    // Ensure we're getting the correct action based on startPlay
    // Usually: items[0] = Play Now, items[1] = Play Next, items[2] = Add to Queue
    const actionIndex = startPlay ? 0 : 2;
    if (actionIndex >= actionListLoad.items.length) {
      logger.error(`Required action index ${actionIndex} not available for: ${track.title}`);
      return null;
    }

    return actionListLoad.items[actionIndex];
  } catch (error) {
    logger.error(`Error in handleActionList for ${track.title}: ${JSON.stringify(error)}`);
    return null;
  }
}

async function executeAction(queueItem: Item, track: TrackToPlay, browseOptions: RoonApiBrowseOptions): Promise<void> {
  await roon.browse({
    hierarchy: "search",
    item_key: queueItem.item_key,
    multi_session_key: browseOptions.multi_session_key,
    zone_or_output_id: track.zoneId,
  });
  logger.debug(`Queuing track: ${track.title} by ${track.artist}`);
}

export async function findTrackByAlbum(track: Track, browseOptions: RoonApiBrowseOptions): Promise<TrackToPlay | null> {
  try {
    // Skip album search if no album is specified
    if (!track.album || track.album.trim() === "") {
      logger.debug(`No album specified for track: ${track.track} by ${track.artist}`);
      return null;
    }

    // Initial browse to get to root menu
    await resetBrowseSession(browseOptions.multi_session_key, "browse");

    // Step 1: Browse into Library first
    logger.debug(`1. Browsing into Library to search for album: ${track.album}`);

    const libraryResponse = await browseIntoLibrary(browseOptions.multi_session_key, browseOptions.zone_or_output_id);

    if (!libraryResponse) {
      return null;
    }

    const searchItem = await getLibrarySearchItem(
      browseOptions.multi_session_key,
      browseOptions.zone_or_output_id,
      libraryResponse
    );

    if (!searchItem) {
      logger.debug(`FAIL. Could not find Search menu item`);
      return null;
    }
    let albumsList;
    try {
      albumsList = await searchForAlbumWithTitle(
        browseOptions.multi_session_key,
        searchItem.item_key,
        browseOptions.zone_or_output_id,
        track.album
      );

      if (!albumsList) {
        logger.debug(`FAIL. No albums found for: ${track.album}`);
        return null;
      }

      // Log all found albums for debugging
      logger.debug(
        "Found albums:",
        albumsList.items.map((item) => ({
          title: item.title,
          artist: item.subtitle,
        }))
      );

      // Step 7: Find exact album match
      const albumMatch = matchAlbumInList(albumsList, track);

      if (!albumMatch) {
        logger.debug(`FAIL. No matching album found for: ${track.album} by ${track.artist}`);
        return null;
      }

      logger.debug(`Found matching album: ${albumMatch.title} by ${albumMatch.subtitle}`);

      // Step 8: Browse into the album
      let albumDetailResponse;
      try {
        albumDetailResponse = await roon.browse({
          hierarchy: "browse",
          item_key: albumMatch.item_key,
          multi_session_key: browseOptions.multi_session_key,
          zone_or_output_id: browseOptions.zone_or_output_id,
        });
      } catch (error) {
        logger.error(`Error browsing album details: ${JSON.stringify(error)}`);
        return null;
      }

      if (!albumDetailResponse.list) {
        logger.debug(`FAIL. No album detail returned`);
        return null;
      }

      let albumDetail;
      try {
        albumDetail = await roon.load({
          hierarchy: "browse",
          multi_session_key: browseOptions.multi_session_key,
          level: albumDetailResponse.list.level,
        });
      } catch (error) {
        logger.error(`Error loading album details: ${JSON.stringify(error)}`);
        return null;
      }

      if (!albumDetail.items[0]) {
        logger.debug(`FAIL. No album item found in detail`);
        return null;
      }

      // Step 9: Browse into the album again to get track listing
      let tracksResponse;
      try {
        tracksResponse = await roon.browse({
          hierarchy: "browse",
          item_key: albumDetail.items[0].item_key,
          multi_session_key: browseOptions.multi_session_key,
          zone_or_output_id: browseOptions.zone_or_output_id,
        });
      } catch (error) {
        logger.error(`Error browsing track listing: ${JSON.stringify(error)}`);
        return null;
      }

      if (!tracksResponse.list) {
        logger.debug(`FAIL. No track listing returned`);
        return null;
      }

      let tracksList;
      try {
        tracksList = await roon.load({
          hierarchy: "browse",
          multi_session_key: browseOptions.multi_session_key,
          level: tracksResponse.list.level,
        });
      } catch (error) {
        logger.error(`Error loading track listing: ${JSON.stringify(error)}`);
        return null;
      }

      // Log tracks for debugging
      logger.debug(`***IMPORTANT*** Album tracks for "${albumMatch.title}" by "${albumMatch.subtitle}":`);
      tracksList.items.forEach((item) => {
        logger.debug(`Track: ${item.title}, Subtitle: ${item.subtitle}`);
      });

      // Step 10: Find matching track with improved matching logic
      const matchingTrack = findTrackInAlbumTracks(tracksList.items, track);

      if (!matchingTrack) {
        logger.debug(`FAIL. No matching track found in album: ${track.album}`);
        // Log the track we were looking for and all available tracks for debugging
        logger.debug(`Looking for track: "${track.track}" by "${track.artist}"`);
        logger.debug("Available tracks:", tracksList.items.map((item) => item.title).join(", "));
        return null;
      }

      logger.debug(`Found matching track: ${matchingTrack.title} by ${matchingTrack.subtitle}`);

      // Return track info for playing - use the track's itemKey directly
      return {
        title: matchingTrack.title,
        artist: matchingTrack.subtitle ?? "",
        image: matchingTrack.image_key ?? "",
        itemKey: matchingTrack.item_key ?? "",
        zoneId: browseOptions.zone_or_output_id ?? "",
      };
    } catch (innerError) {
      logger.error(`Error in album search process for track ${track.track}: ${JSON.stringify(innerError)}`);
      return null;
    }
  } catch (outerError) {
    logger.error(`Unexpected error in findTrackByAlbum: ${JSON.stringify(outerError)}`);
    return null;
  }
}

// Helper function to find a track in album tracks with improved matching
function findTrackInAlbumTracks(tracks: Item[], track: Track): Item | undefined {
  // Skip "Play Album" option and other non-track items
  const actualTracks = tracks.filter(
    (item) => item.title !== "Play Album" && item.hint !== "action" && item.subtitle !== "Play"
  );

  // First try exact match
  for (const item of actualTracks) {
    // Extract track number pattern (like "1-6" or just a number)
    const trackNumberPattern = /^(?:\d+-\d+|\d+)(?:\s+|\.\s+)/;

    // Get the original title for logging
    const originalItemTitle = item.title;
    const originalTrackTitle = track.track;

    // Remove track number and normalize
    const normalizedItemTitle = normalizeString(item.title.replace(trackNumberPattern, ""));
    const normalizedTrackTitle = normalizeString(track.track);

    // Log detailed comparison for debugging
    logger.debug(`Track comparison: "${originalItemTitle}" vs "${originalTrackTitle}"`);
    logger.debug(`Normalized: "${normalizedItemTitle}" vs "${normalizedTrackTitle}"`);

    // Check for exact match
    if (normalizedItemTitle === normalizedTrackTitle) {
      logger.debug(`Found exact match for track: "${item.title}"`);
      return item;
    }
  }

  // If no exact match, try more flexible matching
  for (const item of actualTracks) {
    const trackNumberPattern = /^(?:\d+-\d+|\d+)(?:\s+|\.\s+)/;
    const normalizedItemTitle = normalizeString(item.title.replace(trackNumberPattern, ""));
    const normalizedTrackTitle = normalizeString(track.track);

    // Check if the base title matches (ignoring remaster/version info)
    // This handles cases where the track title is "Nothing Compares 2 U" but the album track is "Nothing Compares 2 U (2009 Remaster)"
    const baseItemTitle = normalizedItemTitle.replace(/\s*(?:remaster|version|mix|edit|mono|stereo).*$/i, "").trim();
    const baseTrackTitle = normalizedTrackTitle.replace(/\s*(?:remaster|version|mix|edit|mono|stereo).*$/i, "").trim();

    logger.debug(`Base title comparison: "${baseItemTitle}" vs "${baseTrackTitle}"`);

    if (baseItemTitle === baseTrackTitle) {
      logger.debug(`Found base title match for track: "${item.title}"`);
      return item;
    }

    // Check for substring match (if one contains the other)
    if (baseItemTitle.includes(baseTrackTitle) || baseTrackTitle.includes(baseItemTitle)) {
      logger.debug(`Found substring match: "${baseItemTitle}" contains or is contained in "${baseTrackTitle}"`);
      return item;
    }

    // Check for similarity by removing special characters
    const cleanItemTitle = baseItemTitle.replace(/[^\w\s]/g, "").trim();
    const cleanTrackTitle = baseTrackTitle.replace(/[^\w\s]/g, "").trim();

    if (cleanItemTitle === cleanTrackTitle) {
      logger.debug(`Found match after removing special characters: "${cleanItemTitle}" = "${cleanTrackTitle}"`);
      return item;
    }
  }

  return undefined;
}

async function findTrackInSearchResults(
  track: Track,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<boolean> {
  logger.debug({ track, startPlay }, "Searching for track");
  try {
    const searchResponse = await performSearch(track, browseOptions);

    if (searchResponse.action !== "list" || !searchResponse.list) {
      logger.debug(`No search results found for: ${track.artist} - ${track.track}`);
      return false;
    }

    const loadResponse = await loadSearchResults(browseOptions.multi_session_key);
    if (!loadResponse.items.length) {
      logger.error("Invalid load response:", loadResponse);
      return false;
    }

    logger.debug({ items: loadResponse.items }, "Search results loaded");

    // First check for direct matches in action_list items
    const directMatch = loadResponse.items.find((item) => {
      if (!item.hint || item.hint !== "action_list") return false;

      const titleMatch = normalizeString(item.title).includes(normalizeString(track.track));
      if (!titleMatch) return false;

      // Handle artist name variations more strictly
      if (!item.subtitle) return false;
      const artistParts = normalizeArtistName(track.artist)
        .split(" and ")
        .map((p) => p.trim());
      const itemArtistParts = normalizeArtistName(item.subtitle)
        .split(/,|\band\b/)
        .map((p) => p.trim());

      // Require at least one artist part to match exactly
      return artistParts.some((artistPart) =>
        itemArtistParts.some(
          (itemArtistPart) =>
            itemArtistPart === artistPart || itemArtistPart.includes(artistPart) || artistPart.includes(itemArtistPart)
        )
      );
    });

    if (directMatch) {
      logger.debug(`Found direct match: ${directMatch.title} by ${directMatch.subtitle}`);
      try {
        await queueSingleTrack(
          {
            title: directMatch.title,
            artist: directMatch.subtitle ?? "",
            image: directMatch.image_key ?? "",
            itemKey: directMatch.item_key ?? "",
            zoneId: browseOptions.zone_or_output_id ?? "",
          },
          browseOptions,
          startPlay
        );
        return true;
      } catch (error) {
        logger.error(`Error queueing track ${track.track}: ${JSON.stringify(error)}`);
        return false;
      }
    }

    // If no direct match, try finding in Tracks section
    const tracksItem = loadResponse.items.find((item) => item.title === "Tracks" && item.hint === "list");

    if (!tracksItem) {
      logger.debug(`No 'Tracks' section found for: ${track.artist} - ${track.track}`);
      return false;
    }

    return await processTracksItem(track, tracksItem, browseOptions, startPlay);
  } catch (error) {
    logger.error(`Error in findTrackInSearchResults for ${track.track}: ${JSON.stringify(error)}`);
    return false;
  }
}

async function processTracksItem(
  track: Track,
  tracksItem: Item,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<boolean> {
  logger.debug({ track, startPlay }, "Processing tracks item");
  const tracksLevelResponse = await roon.browse({
    hierarchy: "search",
    multi_session_key: browseOptions.multi_session_key,
    item_key: tracksItem.item_key,
  });

  if (tracksLevelResponse.action !== "list" || !tracksLevelResponse.list) {
    logger.debug(`No list for search item_key: ${track.artist} - ${track.track}`);
    return false;
  }

  const loadResponse = await roon.load({
    hierarchy: "search",
    multi_session_key: browseOptions.multi_session_key,
    level: 1,
    offset: 0,
    count: 100,
  });

  // Log all tracks for debugging
  logger.debug(
    "Found tracks:",
    loadResponse.items.map((i) => ({
      title: i.title,
      subtitle: i.subtitle,
      hint: i.hint,
    }))
  );

  // First try exact match
  let matchingTrack = findExactMatchingTrack(loadResponse.items, track);

  if (matchingTrack) {
    logger.debug(`Found exact match: ${matchingTrack.title} by ${matchingTrack.subtitle}`);
  } else {
    // If no exact match, try partial match
    matchingTrack = findMatchingTrack(loadResponse.items, track);
    if (matchingTrack) {
      logger.debug(`Found partial match: ${matchingTrack.title} by ${matchingTrack.subtitle}`);
    }
  }

  if (!matchingTrack) {
    logger.debug(`No matching track found for: ${track.artist} - ${track.track}`);
    return false;
  }

  logger.debug(`Found matching track in list: ${matchingTrack.title} by ${matchingTrack.subtitle}`);
  try {
    await queueSingleTrack(
      {
        title: matchingTrack.title,
        artist: matchingTrack.subtitle ?? "",
        image: matchingTrack.image_key ?? "",
        itemKey: matchingTrack.item_key ?? "",
        zoneId: browseOptions.zone_or_output_id ?? "",
      },
      browseOptions,
      startPlay
    );
    return true;
  } catch (error) {
    logger.error(`Error queueing track ${track.track}: ${JSON.stringify(error)}`);
    return false;
  }
}

function findExactMatchingTrack(items: Item[], track: Track): Item | undefined {
  return items.find((item) => {
    if (!item.subtitle) return false;

    const normalizedItemTitle = normalizeString(item.title);
    const normalizedTrackTitle = normalizeString(track.track);
    const normalizedItemArtist = normalizeArtistName(item.subtitle);
    const normalizedTrackArtist = normalizeArtistName(track.artist);

    logger.debug(`Exact match comparison: "${item.title}" (${item.subtitle}) vs "${track.track}" (${track.artist})`);
    logger.debug(
      `Normalized: "${normalizedItemTitle}" (${normalizedItemArtist}) vs "${normalizedTrackTitle}" (${normalizedTrackArtist})`
    );

    // For exact matching, we require exact title match or classical music match
    let titleMatch = normalizedItemTitle === normalizedTrackTitle;

    // If not a direct match, try classical music matching
    if (!titleMatch) {
      // For theme music, require stricter matching
      if (normalizedTrackTitle.includes("theme")) {
        titleMatch = normalizedItemTitle === normalizedTrackTitle;
      } else {
        // Extract key signature if present
        const itemKey = extractKeySignature(normalizedItemTitle);
        const trackKey = extractKeySignature(normalizedTrackTitle);

        // If both have key signatures, they must match
        if (itemKey && trackKey && itemKey !== trackKey) {
          return false;
        }

        // Handle classical music titles that might include composer name
        const [composerPart, ...titleParts] = normalizedTrackTitle.split(":");
        const mainTitle = titleParts.join(" ").trim() || composerPart;

        // Clean and compare titles
        const cleanItemTitle = cleanClassicalTitle(normalizedItemTitle);
        const cleanTrackTitle = cleanClassicalTitle(mainTitle);

        titleMatch = cleanItemTitle === cleanTrackTitle;

        if (titleMatch) {
          logger.debug(`Found classical music match: "${cleanItemTitle}" = "${cleanTrackTitle}"`);
        }
      }
    }

    if (!titleMatch) {
      logger.debug(`Title mismatch: "${normalizedItemTitle}" != "${normalizedTrackTitle}"`);
      return false;
    }

    // Check if the requested artist is in the subtitle
    // This handles cases where the artist is part of a collaboration
    const artistMatch =
      normalizedItemArtist.includes(normalizedTrackArtist) ||
      normalizedTrackArtist.includes(normalizedItemArtist) ||
      // Also check if the artist name appears as part of a multi-artist subtitle
      normalizedItemArtist.split(/\s+/).some((part) => normalizedTrackArtist.includes(part) && part.length > 3);

    if (!artistMatch) {
      logger.debug(`Artist mismatch: "${normalizedItemArtist}" does not match "${normalizedTrackArtist}"`);
      return false;
    }

    logger.debug(`Found exact match: "${item.title}" by "${item.subtitle}"`);
    return true;
  });
}

function findMatchingTrack(items: Item[], track: Track): Item | undefined {
  // Log all items for debugging
  logger.debug(
    "All available tracks for flexible matching:",
    items.map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      normalized: normalizeString(item.title),
    }))
  );

  const normalizedTrackArtist = normalizeArtistName(track.artist);
  logger.debug(`Looking for artist: ${track.artist} (normalized: ${normalizedTrackArtist})`);

  // First try to find tracks that include our artist name
  const artistMatches = items.filter((item) => {
    if (!item.subtitle) return false;

    const normalizedItemArtist = normalizeArtistName(item.subtitle);
    logger.debug(`Comparing with: ${item.subtitle} (normalized: ${normalizedItemArtist})`);

    // Check if the normalized track artist appears in the normalized item artist
    // This handles cases where the artist is part of a collaboration
    const isMatch =
      normalizedItemArtist.includes(normalizedTrackArtist) ||
      normalizedTrackArtist.includes(normalizedItemArtist) ||
      // Also check if any part of a multi-artist subtitle contains our artist
      normalizedItemArtist.split(/\s+/).some((part) => normalizedTrackArtist.includes(part) && part.length > 3) ||
      // Check for similarity by removing all special characters
      normalizedItemArtist.replace(/[^\w\s]/g, "") === normalizedTrackArtist.replace(/[^\w\s]/g, "");

    if (isMatch) {
      logger.debug(`Found artist match: ${item.subtitle}`);
    }
    return isMatch;
  });

  logger.debug(
    `Found ${artistMatches.length} artist matches:`,
    artistMatches.map((item) => ({
      title: item.title,
      artist: item.subtitle,
    }))
  );

  if (artistMatches.length > 0) {
    // Among artist matches, find the best title match
    const normalizedTrackTitle = normalizeString(track.track);

    // First try exact title match
    const exactMatch = artistMatches.find((item) => normalizeString(item.title) === normalizedTrackTitle);

    if (exactMatch) {
      logger.debug(`Found exact title match: ${exactMatch.title}`);
      return exactMatch;
    }

    // Then try matching without parenthetical content
    const cleanMatch = artistMatches.find((item) => {
      const cleanItemTitle = normalizeString(item.title)
        .replace(/\s*\([^)]*\)/g, "")
        .trim();
      const cleanTrackTitle = normalizedTrackTitle.replace(/\s*\([^)]*\)/g, "").trim();
      return cleanItemTitle === cleanTrackTitle;
    });

    if (cleanMatch) {
      logger.debug(`Found clean title match: ${cleanMatch.title}`);
      return cleanMatch;
    }

    // Try matching with common word variations
    const variationMatch = artistMatches.find((item) => {
      const itemTitle = normalizeString(item.title);

      // Handle common variations
      if (normalizedTrackTitle === "get down" && (itemTitle === "getdown" || itemTitle === "get-down")) {
        return true;
      }
      if (normalizedTrackTitle === "get back" && (itemTitle === "getback" || itemTitle === "get-back")) {
        return true;
      }

      // Handle apostrophe variations
      const trackWithoutApostrophes = normalizedTrackTitle.replace(/'/g, "");
      const itemWithoutApostrophes = itemTitle.replace(/'/g, "");
      if (trackWithoutApostrophes === itemWithoutApostrophes) {
        return true;
      }

      return false;
    });

    if (variationMatch) {
      logger.debug(`Found variation match: ${variationMatch.title}`);
      return variationMatch;
    }

    // If still no match, try substring matching
    const substringMatch = artistMatches.find((item) => {
      const normalizedItemTitle = normalizeString(item.title);
      return normalizedItemTitle.includes(normalizedTrackTitle) || normalizedTrackTitle.includes(normalizedItemTitle);
    });

    if (substringMatch) {
      logger.debug(`Found substring match: ${substringMatch.title}`);
      return substringMatch;
    }

    // If we have artist matches but no good title match, return the first one
    // This is a fallback for cases where the track title might be very different
    logger.debug(`No good title match found, using first artist match: ${artistMatches[0].title}`);
    return artistMatches[0];
  }

  return undefined;
}

function extractKeySignature(title: string): string | null {
  const keyMatch = title.match(/\b(in\s+[a-z](?:\s*(?:sharp|flat)?)\s+(?:major|minor))\b/i);
  return keyMatch ? normalizeString(keyMatch[1]) : null;
}

function cleanClassicalTitle(title: string): string {
  return title
    .replace(/^\d+\.\s*/, "") // Remove leading numbers
    .replace(/^the\s+/i, "") // Remove leading "the"
    .replace(/\b(bwv|op|no)\b\s*\d+/gi, "") // Remove BWV, Op., No. numbers
    .replace(/\s*\([^)]*\)/g, "") // Remove parenthetical content
    .replace(/\s*\[[^\]]*\]/g, "") // Remove bracketed content
    .replace(/\s*(?:arr|arranged|transcribed)(?:\s+by)?\s+[^,:]*/gi, "") // Remove arrangement info
    .replace(/\s*(?:performed\s+in|transposed\s+to)\s+[^,:]*/gi, "") // Remove performance key info
    .replace(/\s*[,:]\s*/g, " ") // Normalize punctuation to spaces
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();
}

async function playAlbumTrack(
  track: TrackToPlay,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<void> {
  try {
    // Step 1: Browse to the track to get its actions
    const browseResponse = await roon.browse({
      hierarchy: "browse",
      item_key: track.itemKey,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: track.zoneId,
    });

    if (!browseResponse.list) {
      throw new Error(`No action list returned for track: ${track.title}`);
    }

    // Step 2: Load the list of actions
    const actionList = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: browseResponse.list.level,
    });

    // Log available actions for debugging
    logger.debug(
      "Available actions:",
      actionList.items.map((item) => ({
        title: item.title,
        hint: item.hint,
        item_key: item.item_key,
      }))
    );

    // Step 3: Find the appropriate action based on startPlay
    // startPlay true = "Play Now", false = "Queue"
    const actionTitle = startPlay ? "Play Now" : "Queue";
    const action = actionList.items.find((item) => item.title === actionTitle && item.hint === "action");
    if (!action) {
      throw new Error(`Could not find ${actionTitle} action for track: ${track.title}`);
    }

    logger.debug("Executing action:", {
      title: actionTitle,
      item_key: action.item_key,
      zone_id: track.zoneId,
      multi_session_key: browseOptions.multi_session_key,
    });

    // Step 4: Execute the action
    const actionResponse = await roon.browse({
      hierarchy: "browse",
      item_key: action.item_key,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: track.zoneId,
    });

    // Step 5: Load to complete the action
    if (actionResponse.list) {
      await roon.load({
        hierarchy: "browse",
        multi_session_key: browseOptions.multi_session_key,
        level: actionResponse.list.level,
      });
    }

    logger.debug(`Successfully executed ${actionTitle} for: ${track.title}`);
  } catch (error) {
    logger.error(`Error in playAlbumTrack for ${track.title}:`, error);
    throw error;
  }
}

/**
 * Searches for a track by first finding the artist and then looking for the track
 * in the artist's catalog. This is a fallback method when direct track search fails.
 */
async function findTrackByArtistThenTrack(
  track: Track,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<boolean> {
  logger.debug({ track, startPlay }, "Searching for track by artist-then-track method");
  try {
    // Reset browse session for a fresh search
    await resetBrowseSession(browseOptions.multi_session_key, "search");

    // Search specifically for the artist
    const searchOptions = {
      ...browseOptions,
      hierarchy: "search",
      input: track.artist,
      pop_all: true,
    };

    const searchResponse = await roon.browse(searchOptions);

    if (searchResponse.action !== "list" || !searchResponse.list) {
      logger.debug(`No search results found for artist: ${track.artist}`);
      return false;
    }

    const loadResponse = await loadSearchResults(browseOptions.multi_session_key);
    if (!loadResponse.items.length) {
      logger.error("Invalid load response for artist search:", loadResponse);
      return false;
    }

    logger.debug({ items: loadResponse.items.map((i) => i.title) }, "Artist search results loaded");

    // Look for the artist section
    const artistsItem = loadResponse.items.find((item) => item.title === "Artists" && item.hint === "list");

    if (!artistsItem) {
      logger.debug(`No 'Artists' section found for: ${track.artist}`);
      return false;
    }

    // Browse into the Artists section
    const artistsResponse = await roon.browse({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      item_key: artistsItem.item_key,
    });

    if (artistsResponse.action !== "list" || !artistsResponse.list) {
      logger.debug(`No list for Artists section: ${track.artist}`);
      return false;
    }

    // Load the artists list
    const artistsLoadResponse = await roon.load({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      level: 1,
      offset: 0,
      count: 100,
    });

    // Find the matching artist
    const normalizedArtistName = normalizeArtistName(track.artist);
    const artistMatch = artistsLoadResponse.items.find((item) => {
      const itemArtistName = normalizeArtistName(item.title);
      return (
        itemArtistName === normalizedArtistName ||
        itemArtistName.includes(normalizedArtistName) ||
        normalizedArtistName.includes(itemArtistName) ||
        // Handle "The" prefix variations
        itemArtistName.replace(/^the\s+/i, "") === normalizedArtistName.replace(/^the\s+/i, "")
      );
    });

    if (!artistMatch) {
      logger.debug(`No matching artist found for: ${track.artist}`);
      return false;
    }

    logger.debug(`Found matching artist: ${artistMatch.title}`);

    // Browse into the artist
    const artistResponse = await roon.browse({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      item_key: artistMatch.item_key,
    });

    if (artistResponse.action !== "list" || !artistResponse.list) {
      logger.debug(`No list for artist: ${artistMatch.title}`);
      return false;
    }

    // Load the artist's content
    const artistContentResponse = await roon.load({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      level: 1,
      offset: 0,
      count: 100,
    });

    // Look for the Tracks section in the artist's content
    const tracksItem = artistContentResponse.items.find(
      (item) => (item.title === "Tracks" || item.title === "Top Tracks") && item.hint === "list"
    );

    if (!tracksItem) {
      logger.debug(`No 'Tracks' section found for artist: ${artistMatch.title}`);
      return false;
    }

    // Browse into the Tracks section
    const tracksResponse = await roon.browse({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      item_key: tracksItem.item_key,
    });

    if (tracksResponse.action !== "list" || !tracksResponse.list) {
      logger.debug(`No list for Tracks section of artist: ${artistMatch.title}`);
      return false;
    }

    // Load the tracks
    const tracksLoadResponse = await roon.load({
      hierarchy: "search",
      multi_session_key: browseOptions.multi_session_key,
      level: 1,
      offset: 0,
      count: 100,
    });

    // Find the matching track
    const normalizedTrackTitle = normalizeString(track.track);

    // First try exact match
    let matchingTrack = tracksLoadResponse.items.find((item) => normalizeString(item.title) === normalizedTrackTitle);

    // If no exact match, try more flexible matching
    if (!matchingTrack) {
      matchingTrack = tracksLoadResponse.items.find((item) => {
        const itemTitle = normalizeString(item.title);

        // Try without parentheses
        const cleanItemTitle = itemTitle.replace(/\s*\([^)]*\)/g, "").trim();
        const cleanTrackTitle = normalizedTrackTitle.replace(/\s*\([^)]*\)/g, "").trim();

        if (cleanItemTitle === cleanTrackTitle) {
          return true;
        }

        // Try substring matching
        if (itemTitle.includes(normalizedTrackTitle) || normalizedTrackTitle.includes(itemTitle)) {
          return true;
        }

        // Try without apostrophes
        const itemWithoutApostrophes = itemTitle.replace(/'/g, "");
        const trackWithoutApostrophes = normalizedTrackTitle.replace(/'/g, "");

        if (itemWithoutApostrophes === trackWithoutApostrophes) {
          return true;
        }

        return false;
      });
    }

    if (!matchingTrack) {
      logger.debug(`No matching track found for: ${track.track} by artist: ${artistMatch.title}`);
      return false;
    }

    logger.debug(`Found matching track: ${matchingTrack.title} by artist: ${artistMatch.title}`);

    // Queue the track
    try {
      await queueSingleTrack(
        {
          title: matchingTrack.title,
          artist: artistMatch.title,
          image: matchingTrack.image_key ?? "",
          itemKey: matchingTrack.item_key ?? "",
          zoneId: browseOptions.zone_or_output_id ?? "",
        },
        browseOptions,
        startPlay
      );
      return true;
    } catch (error) {
      logger.error(`Error queueing track ${track.track}: ${JSON.stringify(error)}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error in findTrackByArtistThenTrack for ${track.track}: ${JSON.stringify(error)}`);
    return false;
  }
}
