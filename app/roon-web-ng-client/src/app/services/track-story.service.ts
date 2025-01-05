import { firstValueFrom } from "rxjs";
import { Injectable } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { SuggestedTrack } from "@model";
import { TrackStoryDialogComponent } from "../components/track-story-dialog/track-story-dialog.component";
import { RoonService } from "./roon.service";

@Injectable({
  providedIn: "root",
})
export class TrackStoryService {
  constructor(
    private dialog: MatDialog,
    private roonService: RoonService
  ) {}

  async showTrackStory(track: SuggestedTrack): Promise<void> {
    const story = await firstValueFrom(this.roonService.aiGetTrackStory(track));
    this.dialog.open(TrackStoryDialogComponent, {
      data: story,
      width: "600px",
      maxWidth: "90vw",
    });
  }
}
