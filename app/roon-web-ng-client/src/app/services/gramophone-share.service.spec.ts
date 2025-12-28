import { MockProvider } from "ng-mocks";
import { DOCUMENT } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { DialogService } from "@services/dialog.service";
import { GramophonePayload, GramophoneShareService } from "./gramophone-share.service";

describe("GramophoneShareService", () => {
  let service: GramophoneShareService;
  let dialogService: { open: jest.Mock; close: jest.Mock };
  let mockWindow: {
    location: { hash: string; pathname: string; search: string };
    history: { replaceState: jest.Mock };
  };

  beforeEach(() => {
    dialogService = {
      open: jest.fn(),
      close: jest.fn(),
    };
    mockWindow = {
      location: {
        hash: "",
        pathname: "/",
        search: "",
      },
      history: {
        replaceState: jest.fn(),
      },
    };

    TestBed.configureTestingModule({
      providers: [
        MockProvider(DialogService, dialogService),
        {
          provide: DOCUMENT,
          useValue: {
            defaultView: mockWindow,
          },
        },
      ],
    });
    service = TestBed.inject(GramophoneShareService);
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  describe("checkHashAndOpenDialog", () => {
    it("should do nothing when hash is empty", () => {
      mockWindow.location.hash = "";
      service.checkHashAndOpenDialog();
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it("should do nothing when hash does not start with #gramophone=", () => {
      mockWindow.location.hash = "#other=something";
      service.checkHashAndOpenDialog();
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it("should open dialog with valid gramophone.co.uk payload", () => {
      const payload: GramophonePayload = {
        url: "https://www.gramophone.co.uk/features/article/test-article",
        title: "Test Article Title",
        description: "Test description",
      };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).toHaveBeenCalledTimes(1);
      expect(dialogService.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: payload,
          autoFocus: "input",
        })
      );
    });

    it("should clear hash after processing valid payload", () => {
      const payload: GramophonePayload = {
        url: "https://www.gramophone.co.uk/features/article/test",
        title: "Test",
      };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;
      mockWindow.location.pathname = "/app";
      mockWindow.location.search = "?param=value";

      service.checkHashAndOpenDialog();

      expect(mockWindow.history.replaceState).toHaveBeenCalledWith(null, "", "/app?param=value");
    });

    it("should reject payload with non-gramophone URL", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const payload: GramophonePayload = {
        url: "https://www.example.com/article",
        title: "Test",
      };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("URL host must be gramophone.co.uk"));
      consoleSpy.mockRestore();
    });

    it("should reject payload with missing url", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const payload = { title: "Test" };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("missing url or title"));
      consoleSpy.mockRestore();
    });

    it("should reject payload with missing title", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const payload = { url: "https://www.gramophone.co.uk/test" };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("missing url or title"));
      consoleSpy.mockRestore();
    });

    it("should handle invalid JSON gracefully", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      mockWindow.location.hash = "#gramophone=invalid-json";

      service.checkHashAndOpenDialog();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("Failed to parse Gramophone payload:", expect.any(Error));
      consoleSpy.mockRestore();
    });

    it("should clear hash even when JSON parsing fails", () => {
      jest.spyOn(console, "error").mockImplementation();
      mockWindow.location.hash = "#gramophone=invalid-json";
      mockWindow.location.pathname = "/app";
      mockWindow.location.search = "";

      service.checkHashAndOpenDialog();

      expect(mockWindow.history.replaceState).toHaveBeenCalledWith(null, "", "/app");
    });

    it("should accept payload with selection field", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/article",
        title: "Test Title",
        selection: "Selected text from article",
      };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          data: payload,
        })
      );
    });

    it("should reject payload with invalid URL format", () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const payload = {
        url: "not-a-valid-url",
        title: "Test",
      };
      mockWindow.location.hash = `#gramophone=${encodeURIComponent(JSON.stringify(payload))}`;

      service.checkHashAndOpenDialog();

      expect(dialogService.open).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("invalid URL format"));
      consoleSpy.mockRestore();
    });
  });

  describe("getDefaultQuery", () => {
    it("should return selection when available and non-empty", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/test",
        title: "Test Title",
        description: "Test description",
        selection: "Selected text",
      };

      expect(service.getDefaultQuery(payload)).toBe("Selected text");
    });

    it("should return title when selection is empty", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/test",
        title: "Test Title",
        description: "Test description",
        selection: "   ",
      };

      expect(service.getDefaultQuery(payload)).toBe("Test Title");
    });

    it("should return title when selection is not provided", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/test",
        title: "Test Title",
        description: "Test description",
      };

      expect(service.getDefaultQuery(payload)).toBe("Test Title");
    });

    it("should trim whitespace from selection", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/test",
        title: "Test Title",
        selection: "  Selected text  ",
      };

      expect(service.getDefaultQuery(payload)).toBe("Selected text");
    });

    it("should trim whitespace from title", () => {
      const payload: GramophonePayload = {
        url: "https://gramophone.co.uk/test",
        title: "  Test Title  ",
      };

      expect(service.getDefaultQuery(payload)).toBe("Test Title");
    });
  });
});
