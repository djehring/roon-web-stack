import fs from "fs/promises";
import path from "path";
import { logger } from "@infrastructure";
import { Track } from "../ai-service/types/track";

// Directory where unmatched tracks data is stored
const UNMATCHED_TRACKS_DIR = path.join(process.cwd(), "data", "unmatched-tracks");

interface UnmatchedTracksData {
  timestamp: string;
  count: number;
  tracks: Track[];
}

interface AnalysisResult {
  totalFiles: number;
  totalUnmatchedTracks: number;
  mostCommonArtists: { artist: string; count: number }[];
  mostCommonAlbums: { album: string; count: number }[];
  tracksMissingAlbum: number;
  tracksMissingArtist: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
}

/**
 * Analyzes all unmatched tracks data files to provide insights
 * for improving search algorithms
 */
export async function analyzeUnmatchedTracks(): Promise<AnalysisResult> {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(UNMATCHED_TRACKS_DIR, { recursive: true });

    // Get all JSON files in the directory
    const files = (await fs.readdir(UNMATCHED_TRACKS_DIR)).filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      return {
        totalFiles: 0,
        totalUnmatchedTracks: 0,
        mostCommonArtists: [],
        mostCommonAlbums: [],
        tracksMissingAlbum: 0,
        tracksMissingArtist: 0,
        dateRange: {
          earliest: "",
          latest: "",
        },
      };
    }

    // Collect data from all files
    const allTracks: Track[] = [];
    const timestamps: string[] = [];

    for (const file of files) {
      const filePath = path.join(UNMATCHED_TRACKS_DIR, file);
      const content = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(content) as UnmatchedTracksData;

      allTracks.push(...data.tracks);
      timestamps.push(data.timestamp);
    }

    // Count occurrences of artists and albums
    const artistCounts: Record<string, number> = {};
    const albumCounts: Record<string, number> = {};
    let tracksMissingAlbum = 0;
    let tracksMissingArtist = 0;

    for (const track of allTracks) {
      // Count artists
      if (track.artist) {
        artistCounts[track.artist] = (artistCounts[track.artist] || 0) + 1;
      } else {
        tracksMissingArtist++;
      }

      // Count albums
      if (track.album) {
        albumCounts[track.album] = (albumCounts[track.album] || 0) + 1;
      } else {
        tracksMissingAlbum++;
      }
    }

    // Sort artists and albums by count
    const sortedArtists = Object.entries(artistCounts)
      .map(([artist, count]) => ({ artist, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const sortedAlbums = Object.entries(albumCounts)
      .map(([album, count]) => ({ album, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Sort timestamps to find date range
    timestamps.sort();

    return {
      totalFiles: files.length,
      totalUnmatchedTracks: allTracks.length,
      mostCommonArtists: sortedArtists,
      mostCommonAlbums: sortedAlbums,
      tracksMissingAlbum,
      tracksMissingArtist,
      dateRange: {
        earliest: timestamps[0] || "",
        latest: timestamps[timestamps.length - 1] || "",
      },
    };
  } catch (error) {
    logger.error(`Error analyzing unmatched tracks: ${JSON.stringify(error)}`);
    throw error;
  }
}

/**
 * Retrieves the most recent unmatched tracks data file
 */
export async function getLatestUnmatchedTracks(): Promise<UnmatchedTracksData | null> {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(UNMATCHED_TRACKS_DIR, { recursive: true });

    // Get all JSON files in the directory
    const files = (await fs.readdir(UNMATCHED_TRACKS_DIR)).filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      return null;
    }

    // Sort files by creation time (newest first)
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(UNMATCHED_TRACKS_DIR, file);
        const stats = await fs.stat(filePath);
        return { file, stats };
      })
    );

    fileStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

    // Read the newest file
    const newestFile = fileStats[0].file;
    const filePath = path.join(UNMATCHED_TRACKS_DIR, newestFile);
    const content = await fs.readFile(filePath, "utf-8");

    return JSON.parse(content) as UnmatchedTracksData;
  } catch (error) {
    logger.error(`Error getting latest unmatched tracks: ${JSON.stringify(error)}`);
    return null;
  }
}

/**
 * Cleans up old unmatched tracks data files, keeping only the most recent ones
 * @param keepCount - Number of most recent files to keep
 */
export async function cleanupOldUnmatchedTracksData(keepCount = 10): Promise<void> {
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(UNMATCHED_TRACKS_DIR, { recursive: true });

    // Get all JSON files in the directory
    const files = (await fs.readdir(UNMATCHED_TRACKS_DIR)).filter((file) => file.endsWith(".json"));

    if (files.length <= keepCount) {
      return;
    }

    // Sort files by creation time (newest first)
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(UNMATCHED_TRACKS_DIR, file);
        const stats = await fs.stat(filePath);
        return { file, stats };
      })
    );

    fileStats.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());

    // Delete older files
    const filesToDelete = fileStats.slice(keepCount);

    for (const { file } of filesToDelete) {
      const filePath = path.join(UNMATCHED_TRACKS_DIR, file);
      await fs.unlink(filePath);
      logger.debug(`Deleted old unmatched tracks data file: ${file}`);
    }

    logger.info(`Cleaned up ${filesToDelete.length} old unmatched tracks data files`);
  } catch (error) {
    logger.error(`Error cleaning up old unmatched tracks data: ${JSON.stringify(error)}`);
  }
}
