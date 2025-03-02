import { logger, roon } from "@infrastructure";
import { RoonApiBrowseResponse } from "@model";

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
