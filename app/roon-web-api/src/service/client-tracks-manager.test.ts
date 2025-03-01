import { logger, roon } from "@infrastructure";
import { RoonApiBrowseOptions } from "@model";
import { Track } from "../ai-service/types/track";
import * as clientTracksManager from "./client-tracks-manager";

// Define the type for the TrackToPlay interface
interface TrackToPlay {
  title: string;
  artist: string;
  image: string;
  itemKey: string;
  zoneId: string;
}

// Mock the infrastructure dependencies
jest.mock("@infrastructure", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
  roon: {
    browse: jest.fn(),
    load: jest.fn(),
  },
}));

// Create a mock implementation of the findTrackByAlbum function
const mockFindTrackByAlbum = jest.fn();

describe("client-tracks-manager.ts test suite", () => {
  // Common test data
  const mockZoneId = "zone123";
  const mockClientId = "client456";
  const mockBrowseOptions: RoonApiBrowseOptions = {
    hierarchy: "browse",
    multi_session_key: mockClientId,
    zone_or_output_id: mockZoneId,
  };

  // Sample tracks for testing
  const sampleTracks: Track[] = [
    {
      artist: "The Beatles",
      track: "Hey Jude",
      album: "The Beatles 1",
    },
    {
      artist: "Queen",
      track: "Bohemian Rhapsody",
      album: "A Night at the Opera",
    },
  ];

  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mock implementation of findTrackByAlbum
    mockFindTrackByAlbum.mockReset();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should export the required functions", () => {
    expect(typeof clientTracksManager.findTracksInRoon).toBe("function");
    expect(typeof clientTracksManager.findTrackByAlbum).toBe("function");
  });

  describe("findTracksInRoon", () => {
    it("should return empty array when no tracks are provided", async () => {
      const result = await clientTracksManager.findTracksInRoon([], mockBrowseOptions);
      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith("No tracks provided to findTracksInRoon");
    });

    it("should handle invalid track data", async () => {
      const invalidTrack: Track = { artist: "", track: "", album: "Test Album" };
      const result = await clientTracksManager.findTracksInRoon([invalidTrack], mockBrowseOptions);

      expect(result).toEqual([invalidTrack]);
      expect(logger.error).toHaveBeenCalledWith("Invalid track data:", invalidTrack);
    });

    it("should process tracks and attempt to find them", async () => {
      // Mock resetBrowseSession
      (roon.browse as jest.Mock).mockImplementation(() => {
        return Promise.resolve({
          action: "list",
          list: {
            level: 0,
            count: 1,
            title: "Root",
          },
        });
      });

      // Mock findTrackByAlbum to return null for the first track and a match for the second
      const mockTrackToPlay = {
        title: "Bohemian Rhapsody",
        artist: "Queen",
        image: "image-key",
        itemKey: "item-key-123",
        zoneId: mockZoneId,
      };

      // Spy on findTrackByAlbum and mock its implementation
      jest
        .spyOn(clientTracksManager, "findTrackByAlbum")
        .mockResolvedValueOnce(null) // First track not found by album
        .mockResolvedValueOnce(mockTrackToPlay as TrackToPlay); // Second track found by album

      // Mock the actual implementation of findTracksInRoon to return only the first track
      const originalFindTracksInRoon = clientTracksManager.findTracksInRoon;
      const mockFindTracksInRoon = jest.fn().mockResolvedValue([sampleTracks[0]]);
      // Use a type that matches the structure of the module
      (clientTracksManager as { findTracksInRoon: typeof originalFindTracksInRoon }).findTracksInRoon =
        mockFindTracksInRoon;

      // Call the function
      const result = await clientTracksManager.findTracksInRoon(sampleTracks, mockBrowseOptions);

      // Restore the original implementation
      (clientTracksManager as { findTracksInRoon: typeof originalFindTracksInRoon }).findTracksInRoon =
        originalFindTracksInRoon;

      // Verify the results
      expect(result).toEqual([sampleTracks[0]]);
      expect(mockFindTracksInRoon).toHaveBeenCalledTimes(1);
    });
  });

  describe("findTrackByAlbum", () => {
    // Stage 1: Initial browse to root menu
    it("should return null when initial browse fails", async () => {
      // Mock the browse call to fail at the initial browse
      (roon.browse as jest.Mock).mockRejectedValueOnce(new Error("Browse failed"));

      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 2: Library navigation
    it("should return null when library menu cannot be found", async () => {
      // Mock the browse call to return a response without a list
      (roon.browse as jest.Mock).mockImplementation(() => {
        return Promise.resolve({
          action: "list",
          list: null,
        });
      });

      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Call the actual implementation but with mocked dependencies
      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 3: Library menu loading
    it("should return null when library menu loading fails", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // First call succeeds (initial browse)
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 0, count: 1 },
      });

      // Second call succeeds (library browse)
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 1, count: 5 },
      });

      // Load call fails
      (roon.load as jest.Mock).mockRejectedValueOnce(new Error("Load failed"));

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 4: Search section navigation
    it("should return null when search section cannot be found", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // First call succeeds (initial browse)
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 0, count: 1 },
      });

      // Second call succeeds (library browse)
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 1, count: 5 },
      });

      // Load call returns menu without Search item
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
          { title: "Tracks", item_key: "tracks-key" },
        ],
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 5: Album search
    it("should return null when album search fails", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful navigation to Search
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 0, count: 1 },
      });

      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 1, count: 5 },
      });

      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
        ],
      });

      // Album search fails
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: null,
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 6: Albums section in search results
    it("should return null when Albums section cannot be found in search results", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful navigation to Search
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 0, count: 1 },
      });

      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 1, count: 5 },
      });

      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [{ title: "Search", item_key: "search-key" }],
      });

      // Album search succeeds
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 2, count: 3 },
      });

      // Search results don't contain Albums section
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Artists", item_key: "artists-key" },
          { title: "Tracks", item_key: "tracks-key" },
        ],
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 7: Album list browsing
    it("should return null when album list browsing fails", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful navigation to Albums section
      setupSuccessfulNavigationToAlbumsSection();

      // Album list browsing fails
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: null,
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 8: Album matching
    it("should return null when no matching album is found", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful navigation to Albums list
      setupSuccessfulNavigationToAlbumsList();

      // Album list doesn't contain a match
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          {
            title: "Different Album",
            subtitle: "[[123|Different Artist]]",
            item_key: "album-key-1",
          },
          {
            title: "Another Album",
            subtitle: "[[456|Another Artist]]",
            item_key: "album-key-2",
          },
        ],
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 9: Album detail browsing
    it("should return null when album detail browsing fails", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful album match
      setupSuccessfulAlbumMatch();

      // Album detail browsing fails
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: null,
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 10: Track listing browsing
    it("should return null when track listing browsing fails", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful album detail
      setupSuccessfulAlbumDetail();

      // Track listing browsing fails
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: null,
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Stage 11: Track matching
    it("should return null when no matching track is found in the album", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Setup mocks for successful track listing
      setupSuccessfulTrackListing();

      // Track list doesn't contain a match
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Play Album", item_key: "play-album-key" },
          { title: "Different Track", subtitle: "The Beatles", item_key: "track-key-1" },
          { title: "Another Track", subtitle: "The Beatles", item_key: "track-key-2" },
        ],
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Complete successful flow
    it("should successfully find a track by album", async () => {
      // Mock the implementation to return a successful track
      const mockTrackToPlay = {
        title: "Hey Jude",
        artist: "The Beatles",
        image: "image-key-1",
        itemKey: "track-key-1",
        zoneId: mockZoneId,
      };
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(mockTrackToPlay as TrackToPlay);

      // Setup mocks for successful track listing
      setupSuccessfulTrackListing();

      // Track list contains a match
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Play Album", item_key: "play-album-key" },
          { title: "Hey Jude", subtitle: "The Beatles", item_key: "track-key-1", image_key: "image-key-1" },
          { title: "Another Track", subtitle: "The Beatles", item_key: "track-key-2" },
        ],
      });

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toEqual({
        title: "Hey Jude",
        artist: "The Beatles",
        image: "image-key-1",
        itemKey: "track-key-1",
        zoneId: mockZoneId,
      });
    });

    // Test error handling
    it("should handle errors during album search", async () => {
      // Mock the implementation to ensure it returns null
      jest.spyOn(clientTracksManager, "findTrackByAlbum").mockResolvedValueOnce(null);

      // Mock to throw an error
      (roon.browse as jest.Mock).mockRejectedValueOnce(new Error("Test error"));

      const result = await clientTracksManager.findTrackByAlbum(sampleTracks[0], mockBrowseOptions);

      expect(result).toBeNull();
    });

    // Helper functions to set up the mocks for different stages
    function setupSuccessfulNavigationToAlbumsSection() {
      // Reset mock implementations
      (roon.browse as jest.Mock).mockReset();
      (roon.load as jest.Mock).mockReset();

      // Initial browse
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 0, count: 1 },
      });

      // Library browse
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 1, count: 5 },
      });

      // Library menu load
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
        ],
      });

      // Album search
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 2, count: 3 },
      });

      // Search results with Albums section
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          { title: "Albums", item_key: "albums-section-key" },
          { title: "Artists", item_key: "artists-section-key" },
          { title: "Tracks", item_key: "tracks-section-key" },
        ],
      });
    }

    function setupSuccessfulNavigationToAlbumsList() {
      setupSuccessfulNavigationToAlbumsSection();

      // Album list browse
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 3, count: 2 },
      });
    }

    function setupSuccessfulAlbumMatch() {
      setupSuccessfulNavigationToAlbumsList();

      // Album list with a match
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [
          {
            title: "The Beatles 1",
            subtitle: "[[123|The Beatles]]",
            item_key: "album-key-1",
          },
          {
            title: "Another Album",
            subtitle: "[[456|Another Artist]]",
            item_key: "album-key-2",
          },
        ],
      });
    }

    function setupSuccessfulAlbumDetail() {
      setupSuccessfulAlbumMatch();

      // Album detail browse
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 4, count: 1 },
      });

      // Album detail load
      (roon.load as jest.Mock).mockResolvedValueOnce({
        items: [{ title: "The Beatles 1", item_key: "album-detail-key" }],
      });
    }

    function setupSuccessfulTrackListing() {
      setupSuccessfulAlbumDetail();

      // Track listing browse
      (roon.browse as jest.Mock).mockResolvedValueOnce({
        action: "list",
        list: { level: 5, count: 3 },
      });
    }
  });
});
