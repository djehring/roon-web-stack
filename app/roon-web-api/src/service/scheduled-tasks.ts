import { logger } from "@infrastructure";
import { cleanupOldUnmatchedTracksData } from "./unmatched-tracks-analyzer";

/**
 * Interval in milliseconds for cleaning up old unmatched tracks data
 * Default: 24 hours
 */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Number of most recent unmatched tracks data files to keep
 */
const KEEP_COUNT = 30;

let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Starts the scheduled tasks
 */
export function startScheduledTasks(): void {
  // Stop any existing tasks first
  stopScheduledTasks();

  // Schedule cleanup of old unmatched tracks data
  cleanupInterval = setInterval(() => {
    void (async () => {
      try {
        logger.debug("Running scheduled cleanup of old unmatched tracks data");
        await cleanupOldUnmatchedTracksData(KEEP_COUNT);
      } catch (error) {
        logger.error(`Error in scheduled cleanup of unmatched tracks data: ${JSON.stringify(error)}`);
      }
    })();
  }, CLEANUP_INTERVAL_MS);

  // Run cleanup immediately on startup
  void (async () => {
    try {
      logger.debug("Running initial cleanup of old unmatched tracks data");
      await cleanupOldUnmatchedTracksData(KEEP_COUNT);
    } catch (error) {
      logger.error(`Error in initial cleanup of unmatched tracks data: ${JSON.stringify(error)}`);
    }
  })();

  logger.info("Scheduled tasks started");
}

/**
 * Stops all scheduled tasks
 */
export function stopScheduledTasks(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info("Scheduled tasks stopped");
  }
}
