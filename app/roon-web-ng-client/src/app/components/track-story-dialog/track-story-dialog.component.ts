import { MarkdownModule } from "ngx-markdown";
import { BehaviorSubject } from "rxjs";
import { AsyncPipe, NgIf } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogActions, MatDialogRef } from "@angular/material/dialog";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { SuggestedTrack, TrackStory } from "@model";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-track-story-dialog",
  templateUrl: "./track-story-dialog.component.html",
  styleUrls: ["./track-story-dialog.component.scss"],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatProgressSpinner, NgIf, AsyncPipe, MarkdownModule, MatDialogActions, MatButtonModule],
})
export class TrackStoryDialogComponent {
  private readonly _dialogRef = inject(MatDialogRef);
  private readonly _roonService = inject(RoonService);
  private readonly _$zone = this._roonService.zoneState(inject(SettingsService).displayedZoneId());
  private readonly _isLoading = new BehaviorSubject<boolean>(false);
  readonly isLoading$ = this._isLoading.asObservable();

  readonly $trackDisplay = computed(() => {
    const { title, artist } = this._$zone().nice_playing?.track ?? { title: "", artist: "" };
    return { title, artist };
  });

  private readonly _story = new BehaviorSubject<TrackStory | null>(null);
  readonly $story = this._story.asObservable();

  constructor() {
    this.getTrackStory();
  }

  getTrackStory(): void {
    const track = this.$trackDisplay();
    if (!track.title || !track.artist) {
      return;
    }
    const suggestedTrack: SuggestedTrack = {
      track: track.title,
      artist: track.artist,
    };
    this._isLoading.next(true);
    this._roonService.aiGetTrackStory(suggestedTrack).subscribe({
      next: (result) => {
        this._story.next(result.story);
        this._isLoading.next(false);
      },
      error: () => {
        this._isLoading.next(false);
      },
    });
  }

  closeDialog(): void {
    this._dialogRef.close();
  }
}
