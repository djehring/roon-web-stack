import { ChangeDetectionStrategy, Component, Input, Signal } from "@angular/core";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MatDialog, MatDialogConfig } from "@angular/material/dialog";
import { MatIcon } from "@angular/material/icon";
import { RoonBrowseDialogComponent } from "@components/roon-browse-dialog/roon-browse-dialog.component";
import { SettingsDialogComponent } from "@components/settings-dialog/settings-dialog.component";
import { ZoneQueueDialogComponent } from "@components/zone-queue-dialog/zone-queue-dialog.component";
import { TrackDisplay } from "@model/client";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-zone-actions",
  standalone: true,
  imports: [MatButton, MatIcon, MatIconButton],
  templateUrl: "./zone-actions.component.html",
  styleUrl: "./zone-actions.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneActionsComponent {
  @Input({ required: false }) $trackDisplay?: Signal<TrackDisplay>;
  private readonly _dialog: MatDialog;
  private readonly _settingsService: SettingsService;
  private readonly $isOneColumn: Signal<boolean>;
  readonly $isSmallScreen: Signal<boolean>;

  constructor(dialog: MatDialog, settingsService: SettingsService) {
    this._dialog = dialog;
    this._settingsService = settingsService;
    this.$isOneColumn = this._settingsService.isOneColumn();
    this.$isSmallScreen = this._settingsService.isSmallScreen();
  }

  openBrowseDialog(firstPage: string) {
    const config: MatDialogConfig = {
      restoreFocus: false,
      data: {
        firstPage,
      },
      autoFocus: firstPage === "library" ? "input:first-of-type" : "button.roon-list-item:first-of-type",
      height: "90svh",
      maxHeight: "90svh",
      width: "90svw",
      maxWidth: "90svw",
    };
    this._dialog.open(RoonBrowseDialogComponent, config);
  }

  openSettingsDialog() {
    this._dialog.open(SettingsDialogComponent, {
      restoreFocus: false,
    });
  }

  toggleDisplayQueueTrack() {
    if (this.$isOneColumn()) {
      this._dialog.open(ZoneQueueDialogComponent, {
        restoreFocus: false,
        height: "95svh",
        maxHeight: "95svh",
        width: "90svw",
        maxWidth: "90svw",
        data: {
          $trackDisplay: this.$trackDisplay,
        },
      });
    } else {
      this._settingsService.toggleDisplayQueueTrack();
    }
  }
}
