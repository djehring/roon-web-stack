import { MockProvider } from "ng-mocks";
import { signal, WritableSignal } from "@angular/core";
import { ComponentFixture, fakeAsync, TestBed, tick } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import { NoopAnimationsModule } from "@angular/platform-browser/animations";
import { LibrarySearchAlbumItem, SearchAlbumsResponse } from "@model";
import { GramophonePayload } from "@services/gramophone-share.service";
import { MessageService } from "@services/message.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";
import { GramophoneShareDialogComponent } from "./gramophone-share-dialog.component";

describe("GramophoneShareDialogComponent", () => {
  let payload: GramophonePayload;
  let $displayedZoneId: WritableSignal<string>;
  let settingsService: {
    displayedZoneId: jest.Mock;
  };
  let roonService: {
    searchAlbums: jest.Mock;
    playItem: jest.Mock;
  };
  let messageService: {
    showError: jest.Mock;
    showMessageWithTimeout: jest.Mock;
  };
  let dialogRef: {
    addPanelClass: jest.Mock;
    updateSize: jest.Mock;
    close: jest.Mock;
  };
  let component: GramophoneShareDialogComponent;
  let fixture: ComponentFixture<GramophoneShareDialogComponent>;

  beforeEach(() => {
    payload = {
      url: "https://www.gramophone.co.uk/features/article/test-article",
      title: "Test Article Title",
      description: "Test description",
    };
    $displayedZoneId = signal("zone_id");
    settingsService = {
      displayedZoneId: jest.fn().mockImplementation(() => $displayedZoneId),
    };
    roonService = {
      searchAlbums: jest.fn().mockResolvedValue({ items: [] }),
      playItem: jest.fn().mockResolvedValue(undefined),
    };
    messageService = {
      showError: jest.fn(),
      showMessageWithTimeout: jest.fn(),
    };
    dialogRef = {
      addPanelClass: jest.fn(),
      updateSize: jest.fn(),
      close: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        MockProvider(MAT_DIALOG_DATA, payload),
        MockProvider(SettingsService, settingsService),
        MockProvider(RoonService, roonService),
        MockProvider(MessageService, messageService),
        MockProvider(MatDialogRef<GramophoneShareDialogComponent>, dialogRef),
      ],
      imports: [GramophoneShareDialogComponent, NoopAnimationsModule],
    });

    fixture = TestBed.createComponent(GramophoneShareDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should initialize with payload values", () => {
    expect(component["sourceUrl"]).toBe(payload.url);
    expect(component["sourceTitle"]).toBe(payload.title);
    expect(component["searchQuery"]).toBe(payload.title);
  });

  it("should use selection as default query when available", () => {
    TestBed.resetTestingModule();
    const payloadWithSelection: GramophonePayload = {
      ...payload,
      selection: "Selected text from article",
    };
    TestBed.configureTestingModule({
      providers: [
        MockProvider(MAT_DIALOG_DATA, payloadWithSelection),
        MockProvider(SettingsService, settingsService),
        MockProvider(RoonService, roonService),
        MockProvider(MessageService, messageService),
        MockProvider(MatDialogRef<GramophoneShareDialogComponent>, dialogRef),
      ],
      imports: [GramophoneShareDialogComponent, NoopAnimationsModule],
    });
    fixture = TestBed.createComponent(GramophoneShareDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component["searchQuery"]).toBe("Selected text from article");
  });

  it("should configure dialog panel class and size", () => {
    expect(dialogRef.addPanelClass).toHaveBeenCalledWith("gramophone-share-dialog");
    expect(dialogRef.updateSize).toHaveBeenCalledWith("600px", "80vh");
  });

  describe("performSearch", () => {
    it("should not search with empty query", () => {
      component["searchQuery"] = "";
      component.performSearch();
      expect(roonService.searchAlbums).not.toHaveBeenCalled();
    });

    it("should not search with whitespace-only query", () => {
      component["searchQuery"] = "   ";
      component.performSearch();
      expect(roonService.searchAlbums).not.toHaveBeenCalled();
    });

    it("should call searchAlbums with correct parameters", fakeAsync(() => {
      const mockResults: LibrarySearchAlbumItem[] = [
        { title: "Album 1", item_key: "key1" },
        { title: "Album 2", subtitle: "Artist 2", item_key: "key2", image_key: "img2" },
      ];
      roonService.searchAlbums.mockResolvedValue({ items: mockResults } as SearchAlbumsResponse);

      component["searchQuery"] = "test query";
      component.performSearch();

      expect(component["loading"]).toBe(true);
      expect(roonService.searchAlbums).toHaveBeenCalledWith("zone_id", "test query");

      tick();

      expect(component["loading"]).toBe(false);
      expect(component["searchResults"]).toEqual(mockResults);
    }));

    it("should handle search error", fakeAsync(() => {
      const error = new Error("Search failed");
      roonService.searchAlbums.mockRejectedValue(error);

      component["searchQuery"] = "test query";
      component.performSearch();

      tick();

      expect(component["loading"]).toBe(false);
      expect(messageService.showError).toHaveBeenCalledWith("Search failed", error);
    }));
  });

  describe("playAlbum", () => {
    const album: LibrarySearchAlbumItem = {
      title: "Test Album",
      item_key: "album_key",
    };

    it("should call playItem with correct parameters", fakeAsync(() => {
      component.playAlbum(album);

      expect(messageService.showMessageWithTimeout).toHaveBeenCalledWith('Playing "Test Album"...', "Close", 3000);
      expect(roonService.playItem).toHaveBeenCalledWith("zone_id", "album_key", "Play Now");

      tick();

      expect(dialogRef.close).toHaveBeenCalled();
    }));

    it("should handle play error", fakeAsync(() => {
      const error = new Error("Play failed");
      roonService.playItem.mockRejectedValue(error);

      component.playAlbum(album);

      tick();

      expect(messageService.showError).toHaveBeenCalledWith("Failed to play album", error);
      expect(dialogRef.close).not.toHaveBeenCalled();
    }));
  });

  describe("closeDialog", () => {
    it("should close the dialog", () => {
      component.closeDialog();
      expect(dialogRef.close).toHaveBeenCalled();
    });
  });

  describe("clearSearch", () => {
    it("should clear search query and results", () => {
      component["searchQuery"] = "test query";
      component["searchResults"] = [{ title: "Album", item_key: "key" }];

      component.clearSearch();

      expect(component["searchQuery"]).toBe("");
      expect(component["searchResults"]).toEqual([]);
    });
  });

  describe("getAlbumImageUrl", () => {
    it("should return null when no image_key", () => {
      const album: LibrarySearchAlbumItem = { title: "Album", item_key: "key" };
      expect(component.getAlbumImageUrl(album)).toBeNull();
    });

    it("should return correct URL when image_key is present", () => {
      const album: LibrarySearchAlbumItem = {
        title: "Album",
        item_key: "key",
        image_key: "img_key_123",
      };
      expect(component.getAlbumImageUrl(album)).toBe("/api/image/img_key_123?scale=fit&width=80&height=80");
    });
  });
});
