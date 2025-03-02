import { logger, roon } from "@infrastructure";
import { RoonApiBrowseResponse } from "@model";
import { resetBrowseSession } from "./roon-utils";

// Mock the infrastructure imports
jest.mock("@infrastructure", () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
  roon: {
    browse: jest.fn(),
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
});
