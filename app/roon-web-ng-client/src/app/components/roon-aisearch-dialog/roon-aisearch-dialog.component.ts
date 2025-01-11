import { NgForOf, NgIf } from "@angular/common";
import { AfterViewInit, Component, inject, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButton } from "@angular/material/button";
import { MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from "@angular/material/dialog";
import { MatFormField, MatLabel } from "@angular/material/form-field";
import { MatInput } from "@angular/material/input";
import { MatList, MatListItem } from "@angular/material/list";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { MatSnackBar } from "@angular/material/snack-bar";
import { VoiceRecorderComponent } from "@components/ai-search/voice-recorder.component";
import { SuggestedTrack } from "@model";
import { RoonService } from "@services/roon.service";

@Component({
  selector: "nr-roon-aisearch-dialog",
  templateUrl: "./roon-aisearch-dialog.component.html",
  styleUrls: ["./roon-aisearch-dialog.component.scss"],
  standalone: true,
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
    VoiceRecorderComponent,
  ],
})
export class RoonAISearchDialogComponent implements AfterViewInit {
  @ViewChild(MatInput) searchInput!: MatInput;

  searchQuery: string = "";
  loading: boolean = false;
  searchResults: SuggestedTrack[] = [];
  transcribing: boolean = false;
  private readonly _roonService: RoonService;
  private readonly _snackBar = inject(MatSnackBar);

  constructor(public dialogRef: MatDialogRef<RoonAISearchDialogComponent>) {
    this._roonService = inject(RoonService);
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.searchInput.focus();
    });
  }

  playTracks(): void {
    this.dialogRef.close(this.searchResults);
    this._snackBar.open("Playing selected tracks...", "Close", {
      duration: 300000,
      verticalPosition: "top",
      horizontalPosition: "center",
      panelClass: ["opaque-snackbar"],
    });

    // Fire and forget - no need to wait
    this._roonService.playTracks(this.searchResults).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Error playing tracks:", error);
      this._snackBar.open("Error playing tracks", "Close", {
        duration: 3000,
        verticalPosition: "top",
        horizontalPosition: "center",
        panelClass: ["opaque-snackbar"],
      });
    });
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  performSearch(): void {
    if (!this.searchQuery.trim() || this.searchQuery === "Transcribing audio...") {
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

  onTranscriptionComplete(transcription: string): void {
    // If we're still transcribing, just update the query
    if (transcription === "Transcribing audio...") {
      this.transcribing = true;
      this.searchQuery = transcription;
      this.searchResults = [];
      return;
    }

    this.transcribing = false;
    this.searchQuery = transcription;

    // Only perform search if transcription was successful
    if (transcription && !transcription.startsWith("Error")) {
      this.performSearch();
    }
  }
}
