import { NgForOf, NgIf } from "@angular/common";
import { AfterViewInit, Component, inject, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInput, MatInputModule } from "@angular/material/input";
import { MatListModule } from "@angular/material/list";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { LibrarySearchAlbumItem } from "@model";
import { GramophonePayload } from "@services/gramophone-share.service";
import { MessageService } from "@services/message.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-gramophone-share-dialog",
  templateUrl: "./gramophone-share-dialog.component.html",
  styleUrls: ["./gramophone-share-dialog.component.scss"],
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
  ],
})
export class GramophoneShareDialogComponent implements AfterViewInit {
  @ViewChild(MatInput) private readonly searchInput!: MatInput;

  protected searchQuery = "";
  protected loading = false;
  protected searchResults: LibrarySearchAlbumItem[] = [];
  protected sourceUrl = "";
  protected sourceTitle = "";

  private readonly roonService = inject(RoonService);
  private readonly messageService = inject(MessageService);
  private readonly settingsService = inject(SettingsService);
  private readonly payload = inject<GramophonePayload>(MAT_DIALOG_DATA);

  constructor(protected readonly dialogRef: MatDialogRef<GramophoneShareDialogComponent>) {
    this.dialogRef.addPanelClass("gramophone-share-dialog");
    this.dialogRef.updateSize("600px", "80vh");

    // Initialize from payload
    this.sourceUrl = this.payload.url;
    this.sourceTitle = this.payload.title;
    this.searchQuery = this.getDefaultQuery();
  }

  public ngAfterViewInit(): void {
    setTimeout(() => {
      this.searchInput.focus();
      // Auto-search on dialog open
      if (this.searchQuery.trim()) {
        this.performSearch();
      }
    });
  }

  public performSearch(): void {
    if (!this.searchQuery.trim()) {
      return;
    }

    this.loading = true;
    this.searchResults = [];

    const zoneId = this.settingsService.displayedZoneId()();

    this.roonService
      .searchAlbums(zoneId, this.searchQuery)
      .then((response) => {
        this.searchResults = response.items;
        this.loading = false;
      })
      .catch((error: unknown) => {
        this.loading = false;
        this.messageService.showError("Search failed", error instanceof Error ? error : new Error(String(error)));
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

  public clearSearch(): void {
    this.searchQuery = "";
    this.searchResults = [];
  }

  public getAlbumImageUrl(album: LibrarySearchAlbumItem): string | null {
    if (!album.image_key) {
      return null;
    }
    return `/api/image?image_key=${album.image_key}&scale=fit&width=80&height=80`;
  }

  private getDefaultQuery(): string {
    if (this.payload.selection && this.payload.selection.trim()) {
      return this.payload.selection.trim();
    }
    return this.payload.title.trim();
  }
}
