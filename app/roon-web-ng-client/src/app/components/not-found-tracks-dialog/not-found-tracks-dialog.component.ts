import { NgForOf } from "@angular/common";
import { Component, Inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatListModule } from "@angular/material/list";
import { SuggestedTrack } from "@model";

@Component({
  selector: "nr-not-found-tracks-dialog",
  templateUrl: "./not-found-tracks-dialog.component.html",
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatListModule, NgForOf],
})
export class NotFoundTracksDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<NotFoundTracksDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SuggestedTrack[]
  ) {}

  closeDialog(): void {
    this.dialogRef.close();
  }
}
