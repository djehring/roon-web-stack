import { ChangeDetectionStrategy, Component, Signal, signal } from "@angular/core";
import { MatButton, MatFabButton, MatMiniFabButton } from "@angular/material/button";
import {
  MatDialogActions,
  MatDialogConfig,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from "@angular/material/dialog";
import { MatIcon } from "@angular/material/icon";
import { CustomActionsManagerComponent } from "@components/custom-actions-manager/custom-actions-manager.component";
import { RoonBrowseDialogComponent } from "@components/roon-browse-dialog/roon-browse-dialog.component";
import { SpatialNavigableContainerDirective } from "@directives/spatial-navigable-container.directive";
import { RoonApiBrowseHierarchy } from "@model";
import { CustomActionsManagerDialogConfig, CustomActionsManagerDialogConfigBigFonts } from "@model/client";
import { DialogService } from "@services/dialog.service";
import { SettingsService } from "@services/settings.service";

interface RecordableHierarchy {
  hierarchy: RoonApiBrowseHierarchy;
  label: string;
  icon: string;
}

@Component({
  selector: "nr-custom-action-recorder",
  standalone: true,
  imports: [
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatFabButton,
    MatIcon,
    MatMiniFabButton,
    SpatialNavigableContainerDirective,
  ],
  templateUrl: "./custom-action-recorder.component.html",
  styleUrl: "./custom-action-recorder.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomActionRecorderComponent {
  readonly recordableHierarchies: RecordableHierarchy[] = [
    {
      hierarchy: "albums",
      label: "Albums",
      icon: "album",
    },
    {
      hierarchy: "artists",
      label: "Artists",
      icon: "artist",
    },
    {
      hierarchy: "browse",
      label: "Browse",
      icon: "explore",
    },
    {
      hierarchy: "composers",
      label: "Composers",
      icon: "music_note",
    },
    {
      hierarchy: "genres",
      label: "Genres",
      icon: "artist",
    },
    {
      hierarchy: "playlists",
      label: "Playlists",
      icon: "featured_play_list",
    },
    {
      hierarchy: "internet_radio",
      label: "Radios",
      icon: "radio",
    },
  ];
  private readonly _dialogService: DialogService;
  private readonly _$isBigFont: Signal<boolean>;
  readonly $hierarchy: Signal<RoonApiBrowseHierarchy | undefined>;
  readonly $path: Signal<string[]>;
  readonly $actionIndex: Signal<number | undefined>;
  private _isRecording: boolean;

  constructor(
    dialogService: DialogService,
    settingsService: SettingsService,
    dialogRef: MatDialogRef<CustomActionRecorderComponent>
  ) {
    this._dialogService = dialogService;
    this._$isBigFont = settingsService.isBigFonts();
    this.$hierarchy = signal(undefined);
    this.$path = signal([]);
    this.$actionIndex = signal(undefined);
    this._isRecording = false;
    dialogRef.afterClosed().subscribe(() => {
      if (!this._isRecording) {
        const config = this._$isBigFont() ? CustomActionsManagerDialogConfigBigFonts : CustomActionsManagerDialogConfig;
        this._dialogService.open(CustomActionsManagerComponent, {
          ...config,
        });
      }
    });
  }

  startRecording(hierarchy: RecordableHierarchy) {
    this._isRecording = true;
    const config: MatDialogConfig = {
      restoreFocus: false,
      data: {
        path: {
          hierarchy: hierarchy.hierarchy,
          path: [],
        },
        isRecording: true,
      },
      autoFocus: false,
      height: "95svh",
      maxHeight: "95svh",
      width: "90svw",
      maxWidth: "90svw",
    };
    this._dialogService.open(RoonBrowseDialogComponent, config);
  }

  onCancel() {
    this._dialogService.close();
  }
}
