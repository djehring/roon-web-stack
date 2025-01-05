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
  // Logging with a message and variable
  const len = tracks.length;
  logger.debug({ len }, "Number of tracks to play");
  logger.debug("Received tracks to play:", tracks);

  for (const track of tracks) {
    try {
      logger.debug("About to Search reset");

      // Reset the browse session for a fresh search
      await resetBrowseSession(browseOptions.multi_session_key);
      logger.debug(`Searching for track ${track.artist} - ${track.track}`);

      // Perform the search
      const searchResponse = await performSearch(track, browseOptions);
      logger.debug({ searchResponse }, "Search done");
      if (searchResponse.action === "list" && searchResponse.list) {
        logger.debug("To load");
        const loadResponse = await loadSearchResults(browseOptions.multi_session_key);
        logger.debug({ loadResponse }, "Loaded:");

        // Find the "Tracks" item
        const tracksItem = loadResponse.items.find((item) => item.title === "Tracks");

        if (tracksItem) {
          const tracksLevelResponse = await roon.browse({
            hierarchy: "search",
            multi_session_key: browseOptions.multi_session_key,
            item_key: tracksItem.item_key,
          });

          if (tracksLevelResponse.action === "list" && tracksLevelResponse.list) {
            // Load items from the "Tracks" level
            const loadResponse = await roon.load({
              hierarchy: "search",
              multi_session_key: browseOptions.multi_session_key,
              level: 1,
            });
            logger.debug(`Loaded Tracks: ${JSON.stringify(loadResponse.items)}`);

            const matchingTrack = loadResponse.items.find((item) => {
              const titleMatch = item.title.toLowerCase().includes(track.track.toLowerCase());
              const artistMatch = item.subtitle?.toLowerCase().includes(track.artist.toLowerCase());
              return titleMatch && artistMatch;
            });
            logger.debug(`Matching Track: ${JSON.stringify(matchingTrack)}`);

            if (matchingTrack) {
              logger.debug(`Found matching track: ${matchingTrack.title} by ${matchingTrack.subtitle}`);
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
              if (startPlay) {
                startPlay = false;
              }
            } else {
              logger.debug(`No matching track found for search item_key: ${track.artist} - ${track.track}`);
              unmatchedTracks.push(track);
            }
          } else {
            logger.debug(`No list for search item_key: ${track.artist} - ${track.track}`);
            unmatchedTracks.push(track);
          }
        } else {
          unmatchedTracks.push(track);
          logger.debug(JSON.stringify(loadResponse));
          //log the name of the unfound track
          logger.debug(`No 'Tracks' item found in search results for: ${track.artist} - ${track.track}`);
        }
      } else {
        unmatchedTracks.push(track);
        logger.debug(JSON.stringify(searchResponse));
        logger.debug(`No search results found for: ${track.artist} - ${track.track}`);
      }
    } catch (error) {
      logger.error(`Error processing track ${track.artist} - ${track.track}: ${JSON.stringify(error)}`);
      unmatchedTracks.push(track);
    }
  }
  logger.debug(`Unmatched tracks: ${JSON.stringify(unmatchedTracks)}`);
  return unmatchedTracks;
}

async function resetBrowseSession(clientId: string | undefined): Promise<RoonApiBrowseResponse> {
  const resetOptions = { hierarchy: "search", refresh_list: true, multi_session_key: clientId };
  return roon.browse(resetOptions);
}

async function performSearch(track: Track, browseOptions: RoonApiBrowseOptions): Promise<RoonApiBrowseResponse> {
  const searchOptions = {
    ...browseOptions,
    hierarchy: "search",
    input: `${track.artist} ${track.track}`,
    pop_all: true,
  };
  return roon.browse(searchOptions);
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

async function queueSingleTrack(
  track: TrackToPlay,
  browseOptions: RoonApiBrowseOptions,
  startPlay: boolean
): Promise<void> {
  const searchOptions = {
    ...browseOptions,
    hierarchy: "search",
    item_key: track.itemKey,
  };

  // Step 1: Navigate to the item using its itemKey
  const headerResult = await roon.browse(searchOptions);
  validateBrowseResponse(headerResult, `Playback requested of unsupported id: ${track.itemKey}`);
  if (headerResult.list?.level === 0) return; // Playback starts automatically

  // Step 2: Load the list of items
  const loadResponse = await roon.load(createLoadOptions(browseOptions));
  const queueItem = getPlayableItem(loadResponse, track.itemKey);

  // Step 3: Handle "action_list" hint and execute action
  if (queueItem.hint === "action_list") {
    const actionListItem = await handleActionList(queueItem, track, browseOptions, startPlay);
    await executeAction(actionListItem, track, browseOptions);
  } else if (queueItem.hint === "action") {
    await executeAction(queueItem, track, browseOptions);
  } else {
    throw new Error(`Unsupported item hint for playback. ID: ${track.itemKey}`);
  }
}

function validateBrowseResponse(response: RoonApiBrowseResponse, errorMessage: string): void {
  if (!response.list) {
    throw new Error(errorMessage);
  }
}

function createLoadOptions(browseOptions: RoonApiBrowseOptions): RoonApiBrowseLoadOptions {
  return {
    hierarchy: "search",
    multi_session_key: browseOptions.multi_session_key,
  };
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
): Promise<Item> {
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
  logger.debug(`Handling track: ${track.title} by ${track.artist}. ${JSON.stringify(actionListLoad.items)}`);
  if (startPlay) {
    return actionListLoad.items[0]; // Assumes the 1st item is the desired action
  }
  return actionListLoad.items[2]; // Assumes the 3rd item is the desired action
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
