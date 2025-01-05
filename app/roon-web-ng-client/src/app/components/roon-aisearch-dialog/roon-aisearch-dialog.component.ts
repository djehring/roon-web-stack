import { NgForOf, NgIf } from "@angular/common";
import { Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButton } from "@angular/material/button";
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from "@angular/material/dialog";
import { MatFormField, MatLabel } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatList, MatListItem } from "@angular/material/list";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { SuggestedTrack } from "@model";
import { RoonService } from "@services/roon.service";

@Component({
  selector: "nr-roon-aisearch-dialog",
  templateUrl: "./roon-aisearch-dialog.component.html",
  styleUrls: ["./roon-aisearch-dialog.component.scss"],
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatFormField,
    FormsModule,
    MatInput,
    MatButton,
    MatProgressSpinner,
    MatLabel,
    MatList,
    MatListItem,
    MatDialogActions,
    NgIf,
    NgForOf,
  ],
})
export class RoonAISearchDialogComponent {
  searchQuery: string = "";
  loading: boolean = false;
  searchResults: SuggestedTrack[] = [];
  private readonly _roonService: RoonService;

  constructor(public dialogRef: MatDialogRef<RoonAISearchDialogComponent>) {
    this._roonService = inject(RoonService);
  }

  playTracks(): void {
    this.loading = true;

    // Kick off the playTracks promise without waiting
    void this._roonService.playTracks(this.searchResults).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Error playing tracks:", error);
    });
    // Close the dialog immediately
    this.dialogRef.close(this.searchResults);
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  performSearch(): void {
    if (!this.searchQuery.trim()) {
      return;
    }
    this.loading = true;
    this.searchResults = [];
    this._roonService.aiSearch(this.searchQuery).subscribe({
      next: (result) => {
        this.searchResults = result.items;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }
}
