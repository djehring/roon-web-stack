import { NgClass, NgForOf, NgIf } from "@angular/common";
import { Component, Inject } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatIconModule } from "@angular/material/icon";
import { MatListModule } from "@angular/material/list";
import { MatTooltipModule } from "@angular/material/tooltip";
import { SuggestedTrack } from "@model";

@Component({
  selector: "nr-not-found-tracks-dialog",
  templateUrl: "./not-found-tracks-dialog.component.html",
  styleUrls: ["./not-found-tracks-dialog.component.scss"],
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatListModule, MatIconModule, MatTooltipModule, NgForOf, NgIf, NgClass],
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
