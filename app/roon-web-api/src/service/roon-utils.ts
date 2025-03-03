import { logger, roon } from "@infrastructure";
import { Item, RoonApiBrowseLoadResponse, RoonApiBrowseResponse } from "@model";

/**
 * Resets the Roon browse session to its initial state
 * @param clientId - The client's session key
 * @param hierarchy - The browse hierarchy to reset ("search" or "browse")
 * @returns Promise resolving to the browse response
 */
export async function resetBrowseSession(
  clientId: string | undefined,
  hierarchy: "search" | "browse" = "search"
): Promise<RoonApiBrowseResponse> {
  // Reset to initial context
  const resetOptions = {
    hierarchy,
    pop_all: true, // This will clear the browse stack
    multi_session_key: clientId,
  };

  try {
    // Reset the browse session
    const resetResponse = await roon.browse(resetOptions);

    if (!resetResponse.list) {
      logger.debug(`${hierarchy} session reset did not return a list`);
    }

    return resetResponse;
  } catch (error) {
    // Convert error to a plain object with message
    const errorObj = error instanceof Error ? { message: error.message } : error;
    logger.error(`Failed to reset ${hierarchy} session: ${JSON.stringify(errorObj)}`);
    throw error;
  }
}

/**
 * Browses into the library section of Roon
 * @param clientId - The client's session key
 * @param zoneId - The zone ID
 * @returns Promise resolving to the browse response or null if failed
 */
export async function browseIntoLibrary(
  clientId: string | undefined,
  zoneId: string | undefined
): Promise<Required<Pick<RoonApiBrowseResponse, "list">> | null> {
  try {
    const response = await roon.browse({
      hierarchy: "browse",
      multi_session_key: clientId,
      zone_or_output_id: zoneId,
    });

    if (!response.list) {
      logger.debug("FAIL. No library menu returned");
      return null;
    }

    logger.debug(`Library response: ${JSON.stringify(response)}`);
    return response as Required<Pick<RoonApiBrowseResponse, "list">>;
  } catch (error) {
    logger.error(`Error browsing into library: ${JSON.stringify(error)}`);
    return null;
  }
}

/**
 * Checks if the current menu is the Library menu by verifying the presence of specific menu items
 * @param menu - The loaded menu response from Roon
 * @returns boolean indicating if we're in the Library menu
 */
export function isInLibraryMenu(menu: RoonApiBrowseLoadResponse): boolean {
  const requiredItems = ["Search", "Artists", "Albums", "Tracks"];
  return requiredItems.every((title) => menu.items.find((i) => i.title === title));
}

/**
 * Gets the Search item from the Library menu
 * @param clientId - The client's session key
 * @param zoneId - The zone ID
 * @param libraryResponse - The initial library response
 * @returns Promise resolving to the Search menu item or null if not found
 */
export async function getLibrarySearchItem(
  clientId: string | undefined,
  zoneId: string | undefined,
  libraryResponse: Required<Pick<RoonApiBrowseResponse, "list">>
): Promise<Item | null> {
  try {
    const libraryMenu = await roon.load({
      hierarchy: "browse",
      multi_session_key: clientId,
      level: libraryResponse.list.level,
    });

    logger.debug(`Library menu items: ${JSON.stringify(libraryMenu.items)}`);

    if (isInLibraryMenu(libraryMenu)) {
      // We're already in the Library menu
      logger.debug("Already in Library menu, looking for Search");
      const searchItem = libraryMenu.items.find((item) => item.title === "Search");
      return searchItem && searchItem.item_key ? searchItem : null;
    }

    // Need to navigate to Library first
    logger.debug("At root menu, looking for Library");
    const libraryItem = libraryMenu.items.find((item) => item.title === "Library");
    if (!libraryItem?.item_key) {
      logger.debug(`FAIL. Could not find Library menu item`);
      return null;
    }

    logger.debug(`Now browsing into Library with key: ${libraryItem.item_key}`);

    // Browse into Library
    const libraryContentsResponse = await roon.browse({
      hierarchy: "browse",
      item_key: libraryItem.item_key,
      multi_session_key: clientId,
      zone_or_output_id: zoneId,
    });

    if (!libraryContentsResponse.list) {
      logger.debug(`FAIL. No library contents returned`);
      return null;
    }

    const libraryContents = await roon.load({
      hierarchy: "browse",
      multi_session_key: clientId,
      level: libraryContentsResponse.list.level,
    });

    // Find Search in Library contents
    const searchItem = libraryContents.items.find((item) => item.title === "Search");
    return searchItem && searchItem.item_key ? searchItem : null;
  } catch (error) {
    logger.error(`Error getting library search item: ${JSON.stringify(error)}`);
    return null;
  }
}
