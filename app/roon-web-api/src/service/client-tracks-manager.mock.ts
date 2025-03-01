import { Item, RoonApiBrowseOptions } from "@model";
import { Track } from "../ai-service/types/track";

// Mock for the TrackToPlay interface
export interface MockTrackToPlay {
  title: string;
  artist: string;
  image: string;
  itemKey: string;
  zoneId: string;
}

// Mock implementation of findTrackByAlbum
export const findTrackByAlbum = jest.fn();

// Mock implementation of findTracksInRoon
export const findTracksInRoon = jest.fn();

// Helper function to create mock browse responses
export function createMockBrowseResponse(level: number, count: number) {
  return {
    list: { level, count },
  };
}

// Helper function to create mock load responses with items
export function createMockLoadResponse(items: Item[]) {
  return {
    items,
  };
}

// Helper function to create a mock track
export function createMockTrack(artist: string, track: string, album: string): Track {
  return {
    artist,
    track,
    album,
  };
}

// Helper function to create mock browse options
export function createMockBrowseOptions(zoneId: string, clientId: string): RoonApiBrowseOptions {
  return {
    hierarchy: "browse",
    multi_session_key: clientId,
    zone_or_output_id: zoneId,
  };
}

// Mock for the private TrackToPlay interface
export function createMockTrackToPlay(
  title: string,
  artist: string,
  itemKey: string,
  zoneId: string,
  image: string = "image-key"
): MockTrackToPlay {
  return {
    title,
    artist,
    image,
    itemKey,
    zoneId,
  };
}
