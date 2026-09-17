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
import { matchAlbumInList, matchesArtist, matchTrackInList } from "./matching-utils";
import { browseIntoLibrary, getLibrarySearchItem, resetBrowseSession, searchForAlbumWithTitle } from "./roon-utils";

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

      // Title search first. Album names from GPT are often longer than the
      // title Roon filed the record under, so album-first misses the song.
      const foundByTitle = await findTrackInSearchResults(track, browseOptions, startPlay);
      if (foundByTitle) {
        startPlay = false;
        continue;
      }

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
            const foundTrack = await findTrackByAlbum({ ...track, album: updatedTrack.album }, browseOptions);

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
  // Generate track name variations
  const trackVariations = [
    track.track, // Original track name
    // Handle parenthetical titles: "Main Title (Theme Name)"
    ...(track.track.includes("(")
      ? [
          track.track.replace(/\s*\([^)]*\)/, "").trim(), // Without parentheses
          track.track.match(/\((.*?)\)/)?.[1]?.trim() ?? "", // Just parenthetical content
          // Handle cases like "(ALL OF A SUDDEN) MY HEART SINGS"
          track.track.replace(/^\([^)]*\)\s*/, "").trim(), // Remove parenthetical content at the beginning
        ]
      : []),
    track.track.replace(/^the\s+/i, ""), // Without "the"
    track.track.replace(/\s+theme$/i, ""), // Without "theme"
    // Additional variations for better matching
    track.track.replace(/'/g, ""), // Without apostrophes
    track.track.replace(/\s+/g, " "), // Normalize spaces
  ].filter(Boolean);

  // Remove duplicates from track variations
  const uniqueTrackVariations = [...new Set(trackVariations)];

  // Title alone first. "The Muppets - Mah Na Mah Na" does not hit the track
  // in Roon search the way "Mah Na Mah Na" does.
  const searchVariations = [
    ...uniqueTrackVariations,
    ...uniqueTrackVariations.map((trackVar) => `${trackVar} ${track.artist}`),
    ...uniqueTrackVariations.map((trackVar) => `${track.artist} ${trackVar}`),
    ...uniqueTrackVariations.map((trackVar) => `${track.artist} - ${trackVar}`),
    ...uniqueTrackVariations.map((trackVar) => `${trackVar} - ${track.artist}`),
  ];

  // Remove duplicates from final search variations
  const uniqueSearchVariations = [...new Set(searchVariations)];

  logger.debug(`Search variations for "${track.track}": ${JSON.stringify(uniqueSearchVariations)}`);

  for (const searchTerm of uniqueSearchVariations) {
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
    input: `${track.track} by ${track.artist}`,
    pop_all: true,
  });
}

async function loadSearchResults(client_id?: string): Promise<RoonApiBrowseLoadResponse> {
  const searchLoadOptions: RoonApiBrowseLoadOptions = {
    hierarchy: "search",
    offset: 0,
    count: 25,
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
      const matchingTrack = matchTrackInList(tracksList.items, track, albumMatch.subtitle);

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
    const directMatch = matchTrackInList(
      loadResponse.items.filter((item) => item.hint === "action_list"),
      track
    );

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

  const matchingTrack = matchTrackInList(loadResponse.items, track);

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
    const action = findPlayAction(actionList.items, startPlay);
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

function findPlayAction(items: Item[], startPlay: boolean): Item | undefined {
  const wanted = startPlay ? /play\s*now/i : /^queue$/i;
  return items.find((item) => item.hint === "action" && wanted.test(item.title));
}

/**
 * Searches for a track by first finding the artist and then looking for the track
 * in the artist's catalog. This is a fallback method when direct track search fails.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const artistMatch = artistsLoadResponse.items.find(
      (item) => !!item.item_key && matchesArtist(track.artist, item.title)
    );

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

    const matchingTrack = matchTrackInList(tracksLoadResponse.items, track);

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
