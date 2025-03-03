import { logger, roon } from "@infrastructure";
import { RoonApiBrowseLoadResponse, RoonApiBrowseResponse } from "@model";
import { browseIntoLibrary, getLibrarySearchItem, isInLibraryMenu, resetBrowseSession } from "./roon-utils";

// Mock the infrastructure imports
jest.mock("@infrastructure", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
  roon: {
    browse: jest.fn(),
    load: jest.fn(),
  },
}));

describe("roon-utils", () => {
  describe("resetBrowseSession", () => {
    beforeEach(() => {
      // Clear all mocks before each test
      jest.clearAllMocks();
    });

    it("should successfully reset a search session", async () => {
      // Mock successful response
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
        list: {
          title: "Root",
          level: 0,
          count: 1,
        },
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const clientId = "test-client-id";
      const result = await resetBrowseSession(clientId, "search");

      // Verify the response
      expect(result).toEqual(mockResponse);

      // Verify browse was called with correct parameters
      expect(roon.browse).toHaveBeenCalledWith({
        hierarchy: "search",
        pop_all: true,
        multi_session_key: clientId,
      });

      // Verify no error was logged
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should successfully reset a browse session", async () => {
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
        list: {
          title: "Root",
          level: 0,
          count: 1,
        },
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const clientId = "test-client-id";
      const result = await resetBrowseSession(clientId, "browse");

      expect(result).toEqual(mockResponse);
      expect(roon.browse).toHaveBeenCalledWith({
        hierarchy: "browse",
        pop_all: true,
        multi_session_key: clientId,
      });
    });

    it("should handle missing list in response", async () => {
      // Mock response without list
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const clientId = "test-client-id";
      const result = await resetBrowseSession(clientId);

      expect(result).toEqual(mockResponse);
      expect(logger.debug).toHaveBeenCalledWith("search session reset did not return a list");
    });

    it("should handle undefined clientId", async () => {
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
        list: {
          title: "Root",
          level: 0,
          count: 1,
        },
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const result = await resetBrowseSession(undefined);

      expect(result).toEqual(mockResponse);
      expect(roon.browse).toHaveBeenCalledWith({
        hierarchy: "search",
        pop_all: true,
        multi_session_key: undefined,
      });
    });

    it("should handle browse errors", async () => {
      const error = new Error("Browse failed");
      (roon.browse as jest.Mock).mockRejectedValue(error);

      const clientId = "test-client-id";
      await expect(resetBrowseSession(clientId)).rejects.toThrow(error);

      expect(logger.error).toHaveBeenCalledWith('Failed to reset search session: {"message":"Browse failed"}');
    });
  });

  describe("browseIntoLibrary", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should successfully browse into library", async () => {
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
        list: {
          title: "Library",
          level: 0,
          count: 1,
        },
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const result = await browseIntoLibrary("test-client-id", "test-zone-id");

      expect(result).toEqual(mockResponse);
      expect(roon.browse).toHaveBeenCalledWith({
        hierarchy: "browse",
        multi_session_key: "test-client-id",
        zone_or_output_id: "test-zone-id",
      });
      expect(logger.debug).toHaveBeenCalledWith(`Library response: ${JSON.stringify(mockResponse)}`);
    });

    it("should handle missing list in response", async () => {
      const mockResponse: RoonApiBrowseResponse = {
        action: "list",
      };
      (roon.browse as jest.Mock).mockResolvedValue(mockResponse);

      const result = await browseIntoLibrary("test-client-id", "test-zone-id");

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith("FAIL. No library menu returned");
    });

    it("should handle browse errors", async () => {
      const error = { message: "Browse failed" };
      (roon.browse as jest.Mock).mockRejectedValue(error);

      const result = await browseIntoLibrary("test-client-id", "test-zone-id");

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error browsing into library: {"message":"Browse failed"}');
    });
  });

  describe("getLibrarySearchItem", () => {
    const mockClientId = "test-client-id";
    const mockZoneId = "test-zone-id";
    const mockLibraryResponse: Required<Pick<RoonApiBrowseResponse, "list">> = {
      list: {
        title: "Root",
        level: 1,
        count: 4,
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return Search item when already in Library menu", async () => {
      const mockSearchItem = {
        title: "Search",
        item_key: "search-key",
      };
      const mockLibraryMenu = {
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
          { title: "Tracks", item_key: "tracks-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockLibraryMenu);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toEqual(mockSearchItem);
      expect(roon.load).toHaveBeenCalledWith({
        hierarchy: "browse",
        multi_session_key: mockClientId,
        level: mockLibraryResponse.list.level,
      });
      expect(roon.browse).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Already in Library menu"));
    });

    it("should navigate to Library and return Search item when not in Library menu", async () => {
      const mockRootMenu = {
        items: [
          { title: "Library", item_key: "library-key" },
          { title: "Settings", item_key: "settings-key" },
        ],
      };
      const mockLibraryContents = {
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Other", item_key: "other-key" },
        ],
      };
      const mockBrowseResponse = {
        list: {
          level: 2,
        },
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockRootMenu).mockResolvedValueOnce(mockLibraryContents);
      (roon.browse as jest.Mock).mockResolvedValueOnce(mockBrowseResponse);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toEqual(mockLibraryContents.items[0]);
      expect(roon.browse).toHaveBeenCalledWith({
        hierarchy: "browse",
        item_key: "library-key",
        multi_session_key: mockClientId,
        zone_or_output_id: mockZoneId,
      });
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("At root menu"));
    });

    it("should return null when Search item is not found in Library menu", async () => {
      const mockLibraryMenu = {
        items: [
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
          { title: "Tracks", item_key: "tracks-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockLibraryMenu);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(roon.browse).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("At root menu"));
    });

    it("should return null when Library item is not found", async () => {
      const mockRootMenu = {
        items: [
          { title: "Settings", item_key: "settings-key" },
          { title: "Other", item_key: "other-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockRootMenu);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(roon.browse).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith("FAIL. Could not find Library menu item");
    });

    it("should return null when browse into Library fails", async () => {
      const mockRootMenu = {
        items: [
          { title: "Library", item_key: "library-key" },
          { title: "Settings", item_key: "settings-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockRootMenu);
      (roon.browse as jest.Mock).mockResolvedValueOnce({ list: null });

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith("FAIL. No library contents returned");
    });

    it("should handle errors during load operation", async () => {
      const error = new Error("Load failed");
      (roon.load as jest.Mock).mockRejectedValueOnce(error);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error getting library search item"));
    });

    it("should handle errors during browse operation", async () => {
      const mockRootMenu = {
        items: [
          { title: "Library", item_key: "library-key" },
          { title: "Settings", item_key: "settings-key" },
        ],
      };
      const error = new Error("Browse failed");

      (roon.load as jest.Mock).mockResolvedValueOnce(mockRootMenu);
      (roon.browse as jest.Mock).mockRejectedValueOnce(error);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error getting library search item"));
    });

    it("should handle missing item_key in Search item", async () => {
      const mockLibraryMenu = {
        items: [
          { title: "Search" }, // Missing item_key
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
          { title: "Tracks", item_key: "tracks-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockLibraryMenu);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Already in Library menu"));
    });

    it("should handle missing item_key in Library item", async () => {
      const mockRootMenu = {
        items: [
          { title: "Library" }, // Missing item_key
          { title: "Settings", item_key: "settings-key" },
        ],
      };

      (roon.load as jest.Mock).mockResolvedValueOnce(mockRootMenu);

      const result = await getLibrarySearchItem(mockClientId, mockZoneId, mockLibraryResponse);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith("FAIL. Could not find Library menu item");
    });
  });

  describe("isInLibraryMenu", () => {
    it("should return true when all required items are present", () => {
      const menu: RoonApiBrowseLoadResponse = {
        offset: 0,
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Artists", item_key: "artists-key" },
          { title: "Albums", item_key: "albums-key" },
          { title: "Tracks", item_key: "tracks-key" },
          { title: "Other", item_key: "other-key" },
        ],
        list: {
          title: "Library",
          count: 5,
          level: 1,
        },
      };

      expect(isInLibraryMenu(menu)).toBe(true);
    });

    it("should return false when some required items are missing", () => {
      const menu: RoonApiBrowseLoadResponse = {
        offset: 0,
        items: [
          { title: "Search", item_key: "search-key" },
          { title: "Artists", item_key: "artists-key" },
          { title: "Other", item_key: "other-key" },
        ],
        list: {
          title: "Library",
          count: 3,
          level: 1,
        },
      };

      expect(isInLibraryMenu(menu)).toBe(false);
    });

    it("should return false when menu is empty", () => {
      const menu: RoonApiBrowseLoadResponse = {
        offset: 0,
        items: [],
        list: {
          title: "Library",
          count: 0,
          level: 1,
        },
      };

      expect(isInLibraryMenu(menu)).toBe(false);
    });

    it("should return false when in root menu", () => {
      const menu: RoonApiBrowseLoadResponse = {
        offset: 0,
        items: [
          { title: "Library", item_key: "library-key" },
          { title: "Settings", item_key: "settings-key" },
        ],
        list: {
          title: "Root",
          count: 2,
          level: 0,
        },
      };

      expect(isInLibraryMenu(menu)).toBe(false);
    });
  });
});
