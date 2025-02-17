import { CdkDragDrop, DragDropModule, moveItemInArray } from "@angular/cdk/drag-drop";
import { NgForOf, NgIf } from "@angular/common";
import { AfterViewInit, Component, inject, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialog, MatDialogActions, MatDialogContent, MatDialogRef, MatDialogTitle } from "@angular/material/dialog";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInput, MatInputModule } from "@angular/material/input";
import { MatListModule } from "@angular/material/list";
import { MatProgressSpinnerModule } from "@angular/material/progress-spinner";
import { MatTooltipModule } from "@angular/material/tooltip";
import { VoiceRecorderComponent } from "@components/ai-search/voice-recorder.component";
import { NotFoundTracksDialogComponent } from "@components/not-found-tracks-dialog/not-found-tracks-dialog.component";
import { SuggestedTrack } from "@model";
import { MessageService } from "@services/message.service";
import { RoonService } from "@services/roon.service";

@Component({
  selector: "nr-roon-aisearch-dialog",
  templateUrl: "./roon-aisearch-dialog.component.html",
  styleUrls: ["./roon-aisearch-dialog.component.scss"],
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
    NgIf,
    NgForOf,
    VoiceRecorderComponent,
    DragDropModule,
    MatIconModule,
    MatTooltipModule,
  ],
})
export class RoonAISearchDialogComponent implements AfterViewInit {
  @ViewChild(MatInput) private readonly searchInput!: MatInput;

  protected searchQuery = "";
  protected loading = false;
  protected searchResults: SuggestedTrack[] = [];
  protected swipingStates: Map<number, { swiping: boolean; swipeAmount: number }> = new Map();
  protected transcribing = false;
  protected swipeThreshold = 180;
  protected readonly deleteWidth = 180;
  private touchStart = 0;
  private currentSwipingIndex: number | null = null;
  private wheelAccumulator = 0;
  private readonly wheelThreshold = 180;
  private wheelTimeout: number | null = null;

  private readonly roonService = inject(RoonService);
  private readonly messageService = inject(MessageService);
  private readonly dialog = inject(MatDialog);

  constructor(protected readonly dialogRef: MatDialogRef<RoonAISearchDialogComponent>) {
    this.dialogRef.addPanelClass("ai-search-dialog");
    this.dialogRef.updateSize("600px", "80vh");
  }

  public ngAfterViewInit(): void {
    setTimeout(() => {
      this.searchInput.focus();
    });
  }

  public playTracks(): void {
    this.dialogRef.close(this.searchResults);
    this.messageService.showMessageWithTimeout("Playing selected tracks...", "Close", 3000);

    this.roonService
      .playTracks(this.searchResults)
      .then((response: { items: SuggestedTrack[] }) => {
        if (response.items.length > 0) {
          this.dialog.open(NotFoundTracksDialogComponent, {
            data: response.items,
          });
        }
      })
      .catch((error: unknown) => {
        this.messageService.showError("Error playing tracks", error as Error);
      });
  }

  public closeDialog(): void {
    this.dialogRef.close();
  }

  public clearSearch(): void {
    this.searchQuery = "";
  }

  public performSearch(): void {
    if (!this.searchQuery.trim() || this.searchQuery === "Transcribing audio...") {
      return;
    }
    this.loading = true;
    this.searchResults = [];
    this.swipingStates.clear();

    this.roonService.aiSearch(this.searchQuery).subscribe({
      next: (result) => {
        this.searchResults = result.items;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  public onTranscriptionComplete(transcription: string): void {
    if (transcription === "Transcribing audio...") {
      this.transcribing = true;
      this.loading = true;
      this.searchQuery = transcription;
      this.searchResults = [];
      return;
    }

    this.transcribing = false;
    this.loading = false;
    this.searchQuery = transcription;

    if (transcription && !transcription.startsWith("Error")) {
      this.performSearch();
    }
  }

  public onDrop(event: CdkDragDrop<SuggestedTrack[]>): void {
    moveItemInArray(this.searchResults, event.previousIndex, event.currentIndex);
  }

  public removeTrack(index: number): void {
    this.searchResults.splice(index, 1);
    this.swipingStates.delete(index);
  }

  public onTouchStart(event: TouchEvent, index: number): void {
    this.touchStart = event.touches[0].clientX;
    this.currentSwipingIndex = index;
  }

  public onTouchMove(event: TouchEvent, index: number): void {
    if (this.currentSwipingIndex !== index) return;

    const touchDelta = this.touchStart - event.touches[0].clientX;
    const isSwipingLeft = touchDelta > 0;

    if (isSwipingLeft) {
      this.swipingStates.set(index, {
        swipeAmount: Math.min(touchDelta, this.deleteWidth),
        swiping: touchDelta > this.swipeThreshold * 0.6,
      });
    } else {
      this.swipingStates.delete(index);
    }
  }

  public onTouchEnd(event: TouchEvent, index: number): void {
    if (this.currentSwipingIndex !== index) return;

    const touchDelta = this.touchStart - event.changedTouches[0].clientX;
    if (touchDelta > this.swipeThreshold) {
      this.removeTrack(index);
    } else {
      this.swipingStates.delete(index);
    }
    this.currentSwipingIndex = null;
  }

  public onWheel(event: WheelEvent, index: number): void {
    if (!event.deltaX || Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    this.wheelAccumulator += event.deltaX;

    const swipeAmount = Math.min(Math.max(this.wheelAccumulator, 0), this.deleteWidth);
    this.swipingStates.set(index, {
      swipeAmount,
      swiping: swipeAmount > this.swipeThreshold * 0.6,
    });

    if (this.wheelTimeout !== null) {
      window.clearTimeout(this.wheelTimeout);
    }

    this.wheelTimeout = window.setTimeout(() => {
      if (this.wheelAccumulator > this.wheelThreshold) {
        this.removeTrack(index);
      } else {
        this.swipingStates.delete(index);
      }
      this.wheelAccumulator = 0;
      this.wheelTimeout = null;
    }, 150);
  }

  protected getSwipingState(index: number): { swiping: boolean; swipeAmount: number } {
    return this.swipingStates.get(index) || { swiping: false, swipeAmount: 0 };
  }
}
