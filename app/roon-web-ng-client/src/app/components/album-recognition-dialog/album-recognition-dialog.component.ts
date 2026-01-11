import { NgClass, NgForOf, NgIf } from "@angular/common";
import { AfterViewInit, Component, ElementRef, HostListener, inject, NgZone, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatListModule } from "@angular/material/list";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { AlbumRecognition, LibrarySearchAlbumItem } from "@model";
import { MessageService } from "@services/message.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-album-recognition-dialog",
  templateUrl: "./album-recognition-dialog.component.html",
  styleUrls: ["./album-recognition-dialog.component.scss"],
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatFormFieldModule,
    FormsModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatDialogActions,
    MatIconModule,
    NgIf,
    NgForOf,
    NgClass,
  ],
})
export class AlbumRecognitionDialogComponent implements AfterViewInit {
  @ViewChild("fileInput") private readonly fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild("dropZone") private readonly dropZone!: ElementRef<HTMLDivElement>;

  protected imageData: string | null = null;
  protected imageMimeType: string | null = null;
  protected textDescription = "";
  protected loading = false;
  protected searchResults: LibrarySearchAlbumItem[] = [];
  protected recognitionResult: AlbumRecognition | null = null;
  protected dragOver = false;
  protected searchCompleted = false;

  private readonly roonService = inject(RoonService);
  private readonly messageService = inject(MessageService);
  private readonly settingsService = inject(SettingsService);
  private readonly ngZone = inject(NgZone);

  constructor(protected readonly dialogRef: MatDialogRef<AlbumRecognitionDialogComponent>) {
    this.dialogRef.addPanelClass("album-recognition-dialog");
    this.dialogRef.updateSize("600px", "80vh");
  }

  public ngAfterViewInit(): void {
    // Focus the drop zone for paste events
    setTimeout(() => {
      this.dropZone.nativeElement.focus();
    });
  }

  @HostListener("paste", ["$event"])
  public onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          this.handleImageFile(file);
          event.preventDefault();
          return;
        }
      }
    }
  }

  public onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = true;
  }

  public onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;
  }

  public onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver = false;

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        this.handleImageFile(file);
      } else {
        this.messageService.showError("Invalid file type", new Error("Please drop an image file"));
      }
    }
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.type.startsWith("image/")) {
        this.handleImageFile(file);
      } else {
        this.messageService.showError("Invalid file type", new Error("Please select an image file"));
      }
    }
  }

  public selectFile(): void {
    this.fileInput.nativeElement.click();
  }

  public clearImage(): void {
    this.imageData = null;
    this.imageMimeType = null;
    this.recognitionResult = null;
    this.searchResults = [];
    this.fileInput.nativeElement.value = "";
  }

  public recognizeAlbum(): void {
    if (!this.imageData && !this.textDescription.trim()) {
      this.messageService.showError("No input provided", new Error("Please provide an image or text description"));
      return;
    }

    this.loading = true;
    this.searchResults = [];
    this.recognitionResult = null;

    const zoneId = this.settingsService.displayedZoneId()();

    this.roonService
      .recognizeAlbum({
        image: this.imageData || undefined,
        mimeType: this.imageMimeType || undefined,
        textHint: this.textDescription.trim() || undefined,
        zoneId,
      })
      .then((response) => {
        this.ngZone.run(() => {
          this.recognitionResult = response.recognition || null;
          this.searchResults = this.sortResultsWithAIMatchesFirst(response.libraryResults);
          this.loading = false;
          this.searchCompleted = true;

          if (this.searchResults.length === 0) {
            if (this.recognitionResult) {
              this.messageService.showMessageWithTimeout(
                `Recognized "${this.recognitionResult.albumTitle}" by ` +
                  `${this.recognitionResult.artistName}, but no matches found in library`,
                "Close",
                5000
              );
            } else {
              this.messageService.showMessageWithTimeout("Could not identify album or find matches", "Close", 3000);
            }
          }
        });
      })
      .catch((error: unknown) => {
        this.ngZone.run(() => {
          this.loading = false;
          this.messageService.showError(
            "Recognition failed",
            error instanceof Error ? error : new Error(String(error))
          );
        });
      });
  }

  public playAlbum(album: LibrarySearchAlbumItem): void {
    const zoneId = this.settingsService.displayedZoneId()();

    this.messageService.showMessageWithTimeout(`Playing "${album.title}"...`, "Close", 3000);

    this.roonService
      .playItem(zoneId, album.item_key, "Play Now")
      .then(() => {
        this.dialogRef.close();
      })
      .catch((error: unknown) => {
        this.messageService.showError(
          "Failed to play album",
          error instanceof Error ? error : new Error(String(error))
        );
      });
  }

  public closeDialog(): void {
    this.dialogRef.close();
  }

  public getAlbumImageUrl(album: LibrarySearchAlbumItem): string | null {
    if (!album.image_key) {
      return null;
    }
    return `/api/image?image_key=${album.image_key}&scale=fit&width=80&height=80`;
  }

  public getConfidenceClass(): string {
    if (!this.recognitionResult) return "";
    return `confidence-${this.recognitionResult.confidence}`;
  }

  /**
   * Parses Roon's [[id|name]] format and extracts just the name
   * Falls back to the original string if not in the expected format
   */
  public parseArtistSubtitle(subtitle: string | undefined): string {
    if (!subtitle) return "";
    // Match [[number|name]] pattern and extract the name
    const match = subtitle.match(/\[\[(\d+)\|([^\]]+)\]\]/);
    if (match) {
      return match[2];
    }
    return subtitle;
  }

  /**
   * Checks if an album item matches the AI recognition result
   * Uses case-insensitive comparison of title and artist
   */
  public isAIMatch(album: LibrarySearchAlbumItem): boolean {
    if (!this.recognitionResult) return false;

    const recognizedTitle = this.recognitionResult.albumTitle.toLowerCase();
    const recognizedArtist = this.recognitionResult.artistName.toLowerCase();
    const albumTitle = album.title.toLowerCase();
    const albumArtist = this.parseArtistSubtitle(album.subtitle).toLowerCase();

    // Check if the album title contains the recognized title or vice versa
    const titleMatch = albumTitle.includes(recognizedTitle) || recognizedTitle.includes(albumTitle);

    // Check if the artist matches
    const artistMatch = albumArtist.includes(recognizedArtist) || recognizedArtist.includes(albumArtist);

    return titleMatch && artistMatch;
  }

  /**
   * Returns true when search has completed and we have results to display
   */
  public hasResults(): boolean {
    return this.searchCompleted && !this.loading;
  }

  /**
   * Resets the dialog to search again
   */
  public searchAgain(): void {
    this.searchResults = [];
    this.recognitionResult = null;
    this.searchCompleted = false;
    this.imageData = null;
    this.imageMimeType = null;
    this.textDescription = "";
    this.fileInput.nativeElement.value = "";
    // Focus the drop zone after view updates
    setTimeout(() => {
      this.dropZone.nativeElement.focus();
    });
  }

  /**
   * Sorts results so AI matches appear first
   */
  private sortResultsWithAIMatchesFirst(results: LibrarySearchAlbumItem[]): LibrarySearchAlbumItem[] {
    return [...results].sort((a, b) => {
      const aMatch = this.isAIMatch(a);
      const bMatch = this.isAIMatch(b);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
  }

  private handleImageFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract base64 data from data URL
      const base64Index = result.indexOf(",");
      if (base64Index !== -1) {
        this.imageData = result.substring(base64Index + 1);
        this.imageMimeType = file.type;
      }
    };
    reader.onerror = () => {
      this.messageService.showError("Failed to read image", new Error("Could not read the image file"));
    };
    reader.readAsDataURL(file);
  }
}
