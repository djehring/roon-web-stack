import { logger, roon } from "@infrastructure";
import {
  Item,
  RoonApiBrowseLoadOptions,
  RoonApiBrowseLoadResponse,
  RoonApiBrowseOptions,
  RoonApiBrowseResponse,
} from "@model";
import { Track } from "../ai-service/types/track";

interface TrackToPlay {
  title: string;
  artist: string;
  image: string;
  itemKey: string;
  zoneId: string;
}

export async function findTracksInRoon(tracks: Track[], browseOptions: RoonApiBrowseOptions): Promise<Track[]> {
  const unmatchedTracks: Track[] = [];
  let startPlay = true;
  const len = tracks.length;
  logger.debug({ len, startPlay }, "Starting track search");
  logger.debug("Received tracks to play:", tracks);

  for (const track of tracks) {
    try {
      logger.debug({ track, startPlay }, "Processing track");
      await resetBrowseSession(browseOptions.multi_session_key);

      // Try album-based search first (our new primary method)
      const foundTrack = await findTrackByAlbum(track, browseOptions);
      if (foundTrack) {
        logger.debug(`Found track via album search: ${foundTrack.title}`);
        // Use album-specific playback for tracks found via album search
        await playAlbumTrack(foundTrack, browseOptions, startPlay);
        startPlay = false;
        continue;
      }

      // If album search fails, try direct search as fallback
      logger.debug({ track }, "Album search failed, trying direct search");
      const trackFound = await findTrackInSearchResults(track, browseOptions, startPlay);

      if (trackFound) {
        logger.debug({ track, wasStartPlay: startPlay }, "Track found via direct search");
        startPlay = false;
      } else {
        logger.debug({ track }, "Track not found in any search method");
        unmatchedTracks.push(track);
      }
    } catch (error) {
      logger.error(`Error processing track ${track.artist} - ${track.track}: ${JSON.stringify(error)}`);
      unmatchedTracks.push(track);
    }
  }

  return unmatchedTracks;
}

async function resetBrowseSession(clientId: string | undefined): Promise<RoonApiBrowseResponse> {
  // Reset to initial search context
  const resetOptions = {
    hierarchy: "search",
    pop_all: true, // This will clear the browse stack
    multi_session_key: clientId,
  };

  try {
    // Reset the browse session
    const resetResponse = await roon.browse(resetOptions);

    if (!resetResponse.list) {
      logger.debug("Browse session reset did not return a list");
    }

    return resetResponse;
  } catch (error) {
    logger.error(`Failed to reset browse session: ${JSON.stringify(error)}`);
    throw error;
  }
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

interface AlbumSearchResult {
  albumItem: Item;
  tracksResponse: RoonApiBrowseLoadResponse;
}

function normalizeString(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s*\([^)]*(?:version|mix|edit|remix|remaster|remastered|mono|stereo)\)[^)]*\)?/gi, "") // Remove version decorations
    .replace(/\s*\[.*?\]/g, "") // Remove content in square brackets
    .replace(/\s*-\s*/g, " ") // Normalize dashes
    .replace(/[^\w\s'"-:,]/g, "") // Keep only word chars, spaces, quotes, dashes, colons, and commas
    .replace(/\s+/g, " ") // Normalize spaces
    .replace(/:\s*/g, " ") // Normalize colons to spaces
    .replace(/,\s*/g, " ") // Normalize commas to spaces
    .replace(/^\d+\s*/, "") // Remove leading track numbers
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function searchAndLoadAlbum(
  albumName: string,
  browseOptions: RoonApiBrowseOptions
): Promise<AlbumSearchResult | null> {
  // Try different variations of the album name
  const searchVariations = [
    albumName,
    albumName.replace(/^the best of/i, "").trim(),
    albumName.replace(/^the very best of/i, "").trim(),
    albumName.replace(/^the piano magic of/i, "").trim(),
    // Add artist name only
    albumName.replace(/^.*?of\s+/i, "").trim(),
  ];

  logger.debug("Trying album variations:", searchVariations);

  for (const searchTerm of searchVariations) {
    const searchOptions = {
      ...browseOptions,
      hierarchy: "search",
      input: searchTerm,
      pop_all: true,
    };

    const searchResponse = await roon.browse(searchOptions);
    if (searchResponse.action !== "list" || !searchResponse.list) {
      logger.debug(`Album search failed for term: ${searchTerm}`);
      continue;
    }

    const loadResponse = await loadSearchResults(browseOptions.multi_session_key);
    logger.debug("Album search results:", {
      searchTerm,
      results: loadResponse.items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        hint: item.hint,
      })),
    });

    // Look for Albums section first
    const albumsSection = loadResponse.items.find((item) => item.title === "Albums" && item.hint === "list");

    if (albumsSection) {
      const albumsResponse = await roon.browse({
        hierarchy: "search",
        multi_session_key: browseOptions.multi_session_key,
        item_key: albumsSection.item_key,
      });

      if (albumsResponse.action === "list" && albumsResponse.list) {
        const albumsLoadResponse = await roon.load({
          hierarchy: "search",
          multi_session_key: browseOptions.multi_session_key,
          level: albumsResponse.list.level,
        });

        // Log album results for debugging
        logger.debug(
          "Found albums:",
          albumsLoadResponse.items.map((i) => ({
            title: i.title,
            subtitle: i.subtitle,
            normalized: normalizeString(i.title),
          }))
        );

        // Try to find the album with more flexible matching
        const albumMatch = albumsLoadResponse.items.find((item) => {
          const normalizedTitle = normalizeString(item.title);
          const normalizedAlbum = normalizeString(albumName);

          // Create variations of the album title
          const albumVariations = [
            normalizedAlbum,
            normalizedAlbum.replace(/^the\s+/i, ""),
            normalizedAlbum.replace(/^the best of\s+/i, ""),
            normalizedAlbum.replace(/^the very best of\s+/i, ""),
            normalizedAlbum.replace(/^the piano magic of\s+/i, ""),
            normalizedAlbum.replace(/^.*?of\s+/i, ""),
          ];

          // Try matching against all variations
          return albumVariations.some(
            (variation) =>
              normalizedTitle === variation ||
              normalizedTitle.includes(variation) ||
              variation.includes(normalizedTitle)
          );
        });

        if (albumMatch) {
          logger.debug(`Found matching album: ${albumMatch.title}`);
          const tracksResponse = await roon.load({
            hierarchy: "search",
            multi_session_key: browseOptions.multi_session_key,
            level: 1,
          });

          return { albumItem: albumMatch, tracksResponse };
        }
      }
    }
  }

  return null;
}

export async function findTrackByAlbum(track: Track, browseOptions: RoonApiBrowseOptions): Promise<TrackToPlay | null> {
  try {
    // Initial browse to get to root menu
    await roon.browse({
      hierarchy: "browse",
      pop_all: true,
      multi_session_key: browseOptions.multi_session_key,
    });

    // Step 1: Browse into Library first
    logger.debug(`1. Browsing into Library to search for album: ${track.album}`);

    const libraryResponse = await roon.browse({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: browseOptions.zone_or_output_id,
    });

    if (!libraryResponse.list) {
      logger.debug(`FAIL. No library menu returned`);
      return null;
    }

    logger.debug(`Library response: ${JSON.stringify(libraryResponse)}`);

    const libraryMenu = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: libraryResponse.list.level,
    });

    logger.debug(`Library menu items: ${JSON.stringify(libraryMenu.items)}`);

    // Check if we need to navigate to Library or if we're already there
    const isInLibrary = ["Search", "Artists", "Albums", "Tracks"].every((title) =>
      libraryMenu.items.find((i) => i.title === title)
    );

    let searchItem;
    if (isInLibrary) {
      // We're already in the Library menu
      logger.debug("Already in Library menu, looking for Search");
      searchItem = libraryMenu.items.find((item) => item.title === "Search");
    } else {
      // Need to navigate to Library first
      logger.debug("At root menu, looking for Library");
      const libraryItem = libraryMenu.items.find((item) => item.title === "Library");
      if (!libraryItem) {
        logger.debug(`FAIL. Could not find Library menu item`);
        return null;
      }

      logger.debug(`2. Now browsing into Library with key: ${libraryItem.item_key}`);

      // Step 2: Browse into Library
      const libraryContentsResponse = await roon.browse({
        hierarchy: "browse",
        item_key: libraryItem.item_key,
        multi_session_key: browseOptions.multi_session_key,
        zone_or_output_id: browseOptions.zone_or_output_id,
      });

      if (!libraryContentsResponse.list) {
        logger.debug(`FAIL. No library contents returned`);
        return null;
      }

      const libraryContents = await roon.load({
        hierarchy: "browse",
        multi_session_key: browseOptions.multi_session_key,
        level: libraryContentsResponse.list.level,
      });

      // Find Search in Library contents
      searchItem = libraryContents.items.find((item) => item.title === "Search");
    }

    // Step 3: Find and select Search section
    if (!searchItem) {
      logger.debug(`FAIL. Could not find Search section in Library`);
      return null;
    }

    logger.debug(`3. Now browsing into Search with key: ${searchItem.item_key} and album: ${track.album}`);

    // Step 4: Browse into Search and perform search
    const searchResponse = await roon.browse({
      hierarchy: "browse",
      item_key: searchItem.item_key,
      input: track.album,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: browseOptions.zone_or_output_id,
    });

    if (!searchResponse.list) {
      logger.debug(`FAIL. No search results returned`);
      return null;
    }

    logger.debug(`4. Now browsing into Search results with level: ${searchResponse.list.level}`);

    const searchResults = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: searchResponse.list.level,
    });

    // Log search results for debugging
    logger.debug(
      "5. Search results:",
      searchResults.items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        hint: item.hint,
      }))
    );

    // Step 5: Find and select Albums section
    const albumsSection = searchResults.items.find((item) => item.title === "Albums");
    if (!albumsSection) {
      logger.debug(`FAIL. No Albums section found in search results`);
      return null;
    }

    logger.debug(`6. Now browsing into Albums with key: ${albumsSection.item_key}`);

    // Step 6: Browse albums list
    const albumsResponse = await roon.browse({
      hierarchy: "browse",
      item_key: albumsSection.item_key,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: browseOptions.zone_or_output_id,
    });

    if (!albumsResponse.list) {
      logger.debug(`FAIL. No album list returned`);
      return null;
    }

    const albumsList = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: albumsResponse.list.level,
    });

    // Log albums for debugging
    logger.debug(
      "Found albums:",
      albumsList.items.map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
      }))
    );

    // Step 7: Find exact album match
    const albumMatch = albumsList.items.find((item) => {
      const normalizedTitle = normalizeString(item.title);
      const normalizedAlbum = normalizeString(track.album);

      // Extract artist name from [[id|name]] format
      const artistMatch = item.subtitle?.match(/\[\[\d+\|(.*?)\]\]/)?.[1] === track.artist;

      return normalizedTitle === normalizedAlbum && artistMatch;
    });

    if (!albumMatch) {
      logger.debug(`FAIL. No matching album found for: ${track.album} by ${track.artist}`);
      return null;
    }

    logger.debug(`Found matching album: ${albumMatch.title} by ${albumMatch.subtitle}`);

    // Step 8: Browse into the album
    const albumDetailResponse = await roon.browse({
      hierarchy: "browse",
      item_key: albumMatch.item_key,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: browseOptions.zone_or_output_id,
    });

    if (!albumDetailResponse.list) {
      logger.debug(`FAIL. No album detail returned`);
      return null;
    }

    const albumDetail = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: albumDetailResponse.list.level,
    });

    if (!albumDetail.items[0]) {
      logger.debug(`FAIL. No album item found in detail`);
      return null;
    }

    // Step 9: Browse into the album again to get track listing
    const tracksResponse = await roon.browse({
      hierarchy: "browse",
      item_key: albumDetail.items[0].item_key,
      multi_session_key: browseOptions.multi_session_key,
      zone_or_output_id: browseOptions.zone_or_output_id,
    });

    if (!tracksResponse.list) {
      logger.debug(`FAIL. No track listing returned`);
      return null;
    }

    const tracksList = await roon.load({
      hierarchy: "browse",
      multi_session_key: browseOptions.multi_session_key,
      level: tracksResponse.list.level,
    });

    // Log tracks for debugging
    logger.debug("***IMPORTANT*** Album tracks:");
    tracksList.items.forEach((item) => {
      logger.debug(`Track: ${item.title}, Subtitle: ${item.subtitle}`);
    });

    // Step 10: Find matching track
    const matchingTrack = tracksList.items.find((item) => {
      // Skip "Play Album" option
      if (item.title === "Play Album") return false;

      const normalizedItemTitle = normalizeString(item.title.replace(/^\d+\.\s+/, "")); // Remove track number
      logger.debug(`Normalized item title: ${normalizedItemTitle}`);
      const normalizedTrackTitle = normalizeString(track.track);
      logger.debug(`Normalized track title: ${normalizedTrackTitle}`);
      // For the original album version, we don't want any special versions
      return normalizedItemTitle === normalizedTrackTitle; // Must be by Simon & Garfunkel
    });

    if (!matchingTrack) {
      logger.debug(`FAIL. No matching track found in album: ${track.album}`);
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
  } catch (error) {
    logger.error(`Error searching album for track ${track.track}: ${JSON.stringify(error)}`);
    return null;
  }
}

async function findTrackInSearchResults(
  track: Track,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<boolean> {
  logger.debug({ track, startPlay }, "Searching for track");
  const searchResponse = await performSearch(track, browseOptions);

  if (searchResponse.action !== "list" || !searchResponse.list) {
    logger.debug(`No search results found for: ${track.artist} - ${track.track}`);
    return false;
  }

  const loadResponse = await loadSearchResults(browseOptions.multi_session_key);
  logger.debug({ items: loadResponse.items }, "Search results loaded");

  // First check for direct matches in action_list items
  const directMatch = loadResponse.items.find((item) => {
    if (item.hint !== "action_list") return false;

    const titleMatch = normalizeString(item.title).includes(normalizeString(track.track));
    if (!titleMatch) return false;

    // Handle artist name variations more strictly
    if (!item.subtitle) return false;
    const artistParts = normalizeString(track.artist)
      .split(" and ")
      .map((p) => p.trim());
    const itemArtistParts = normalizeString(item.subtitle)
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

  return processTracksItem(track, tracksItem, browseOptions, startPlay);
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
    const normalizedItemArtist = normalizeString(item.subtitle);
    const normalizedTrackArtist = normalizeString(track.artist);

    // For theme music, require stricter matching
    if (normalizedTrackTitle.includes("theme")) {
      return normalizedItemTitle === normalizedTrackTitle && normalizedItemArtist.includes(normalizedTrackArtist);
    }

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

    // Split artist names and check if all parts match
    const artistParts = normalizedTrackArtist.split(" and ");
    const artistMatch = artistParts.every((part) => normalizedItemArtist.includes(normalizeString(part)));

    // For classical music, check if composer is in subtitle
    const composerMatch = titleParts.length > 0 ? normalizedItemArtist.includes(normalizeString(composerPart)) : true;

    // Clean and compare titles
    const cleanItemTitle = cleanClassicalTitle(normalizedItemTitle);
    const cleanTrackTitle = cleanClassicalTitle(mainTitle);

    return cleanItemTitle === cleanTrackTitle && (artistMatch || composerMatch);
  });
}

function findMatchingTrack(items: Item[], track: Track): Item | undefined {
  // Log all items for debugging
  logger.debug(
    "All available tracks:",
    items.map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      normalized: normalizeString(item.title),
    }))
  );

  for (const item of items) {
    if (!item.subtitle) continue;

    const normalizedItemTitle = normalizeString(item.title);
    const normalizedTrackTitle = normalizeString(track.track);
    const normalizedItemArtist = normalizeString(item.subtitle);
    const normalizedTrackArtist = normalizeString(track.artist);

    // Log each comparison in detail
    logger.debug("Comparing:", {
      itemTitle: normalizedItemTitle,
      trackTitle: normalizedTrackTitle,
      itemArtist: normalizedItemArtist,
      trackArtist: normalizedTrackArtist,
      hint: item.hint,
      originalTitle: item.title,
      originalSubtitle: item.subtitle,
    });

    // First check if artist matches
    const artistParts = normalizedTrackArtist.split(" and ").map((p) => p.trim());
    const itemArtistParts = normalizedItemArtist.split(/,|\band\b/).map((p) => p.trim());

    // Require at least one artist part to match exactly
    const artistMatch = artistParts.some((artistPart) =>
      itemArtistParts.some(
        (itemArtistPart) =>
          itemArtistPart === artistPart || itemArtistPart.includes(artistPart) || artistPart.includes(itemArtistPart)
      )
    );

    if (!artistMatch) {
      logger.debug("Artist mismatch:", {
        artistParts,
        itemArtistParts,
        normalizedTrackArtist,
        normalizedItemArtist,
      });
      continue;
    }

    // For theme music, try different variations
    if (normalizedTrackTitle.includes("theme")) {
      // Extract the main title if it's in parentheses format: "Main Title (Theme Name)"
      const parenthesesMatch = normalizedTrackTitle.match(/^(.*?)\s*\((.*?)\)$/);
      const alternateTitle = parenthesesMatch?.[1]?.trim() ?? "";
      const themeTitle = parenthesesMatch?.[2]?.trim() ?? "";

      const baseTitle = normalizedTrackTitle
        .replace(/^the\s+/i, "")
        .replace(/\s*theme$/i, "")
        .replace(/\s*\(.*?\)$/i, "") // Remove parenthetical content at the end
        .trim();

      const variations = [
        normalizedTrackTitle,
        baseTitle,
        ...(alternateTitle ? [alternateTitle] : []),
        ...(themeTitle ? [themeTitle] : []),
        `theme from ${baseTitle}`,
        `${baseTitle} theme`,
        baseTitle.replace(/\s+/g, ""),
        `${baseTitle} signature tune`,
        `${baseTitle} signature theme`,
        `${baseTitle} title theme`,
        `${baseTitle} title music`,
        `theme music from ${baseTitle}`,
        `${baseTitle} opening theme`,
      ];

      logger.debug("Theme variations:", variations);

      const titleMatch = variations.some((v) => {
        const itemVariations = [
          normalizedItemTitle,
          normalizedItemTitle.replace(/^the\s+/i, ""),
          normalizedItemTitle.replace(/\s*theme$/i, ""),
          normalizedItemTitle.replace(/^the\s+|\s*theme$/gi, ""),
          normalizedItemTitle.replace(/\s*\(.*?\)$/i, ""), // Remove parenthetical content at the end
        ];

        const matches = itemVariations.some((iv) => iv.includes(v) || v.includes(iv));

        if (matches) {
          logger.debug(`Found matching variation: ${v} matches ${normalizedItemTitle}`);
        }
        return matches;
      });

      if (titleMatch) {
        logger.debug("Found theme music match:", {
          itemTitle: item.title,
          itemArtist: item.subtitle,
          matchType: "theme",
          variations,
        });
        return item;
      }
      continue;
    }

    // Rest of the existing matching logic...
    const itemKey = extractKeySignature(normalizedItemTitle);
    const trackKey = extractKeySignature(normalizedTrackTitle);

    if (itemKey && trackKey && itemKey !== trackKey) continue;

    const [composerPart, ...titleParts] = normalizedTrackTitle.split(":");
    const mainTitle = titleParts.join(" ").trim() || composerPart;

    const cleanItemTitle = cleanClassicalTitle(normalizedItemTitle);
    const cleanTrackTitle = cleanClassicalTitle(mainTitle);

    const itemWords = new Set(cleanItemTitle.split(" ").filter(isSignificantWord));
    const trackWords = new Set(cleanTrackTitle.split(" ").filter(isSignificantWord));

    const minMatchRatio = Math.min(trackWords.size, 3) <= 2 ? 0.8 : 0.5;
    const commonWords = [...itemWords].filter((word) => trackWords.has(word));
    const matchRatio = commonWords.length / Math.min(itemWords.size, trackWords.size);

    if (matchRatio >= minMatchRatio) {
      logger.debug("Found match with ratio:", {
        ratio: matchRatio,
        commonWords,
        itemWords: [...itemWords],
        trackWords: [...trackWords],
      });
      return item;
    }
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

function isSignificantWord(word: string): boolean {
  // Skip common classical music terms that don't help with matching
  const commonTerms = new Set([
    "movement",
    "allegro",
    "andante",
    "adagio",
    "scherzo",
    "rondo",
    "major",
    "minor",
    "sharp",
    "flat",
    "the",
    "for",
    "with",
    "and",
    "in",
    "by",
    "op",
    "no",
    "bwv",
    "k",
    "s",
    "from",
    "to",
    "of",
    "arranged",
    "transcribed",
    "performed",
  ]);

  return word.length > 2 && !commonTerms.has(word.toLowerCase());
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
