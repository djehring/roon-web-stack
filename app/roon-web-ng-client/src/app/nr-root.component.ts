import { deepEqual } from "fast-equals";
import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, inject, Signal } from "@angular/core";
import { MatProgressSpinner } from "@angular/material/progress-spinner";
import { ExtensionNotEnabledComponent } from "@components/extension-not-enabled/extension-not-enabled.component";
import { FullScreenToggleComponent } from "@components/full-screen-toggle/full-screen-toggle.component";
import { ZoneContainerComponent } from "@components/zone-container/zone-container.component";
import { ZoneSelectorComponent } from "@components/zone-selector/zone-selector.component";
import { RoonState } from "@model";
import { DisplayMode } from "@model/client";
import { NgxSpatialNavigableRootDirective } from "@nihilux/ngx-spatial-navigable";
import { DialogService } from "@services/dialog.service";
import { GramophoneShareService } from "@services/gramophone-share.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-root",
  imports: [
    CommonModule,
    ExtensionNotEnabledComponent,
    FullScreenToggleComponent,
    MatProgressSpinner,
    NgxSpatialNavigableRootDirective,
    ZoneContainerComponent,
    ZoneSelectorComponent,
  ],
  templateUrl: "./nr-root.component.html",
  styleUrl: "./nr-root.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NrRootComponent {
  private readonly _dialogService: DialogService;
  private readonly _gramophoneShareService: GramophoneShareService;
  private _hasCheckedGramophoneHash = false;
  readonly $clientState: Signal<string>;
  readonly $isWithFullScreen: Signal<boolean>;

  constructor() {
    this._dialogService = inject(DialogService);
    this._gramophoneShareService = inject(GramophoneShareService);
    const roonService = inject(RoonService);
    const settingsService = inject(SettingsService);
    const $displayedZoneId = settingsService.displayedZoneId();
    const $apiState = roonService.roonState();
    const $isGrouping = roonService.isGrouping();
    this.$clientState = computed(
      () => {
        const { state, zones } = $apiState();
        if (state === RoonState.SYNC) {
          if ($isGrouping()) {
            return "GROUPING";
          }
          const displayedZonedId = $displayedZoneId();
          if (zones.findIndex((zd) => zd.zone_id === displayedZonedId) === -1) {
            return "NEED_SELECTION";
          }
        }
        return state;
      },
      {
        equal: deepEqual,
      }
    );
    const $isOneColumn = settingsService.isOneColumn();
    const $displayMode = settingsService.displayMode();
    this.$isWithFullScreen = computed(() => !$isOneColumn() && $displayMode() !== DisplayMode.TEN_FEET);
    effect(() => {
      this.$clientState();
      this._dialogService.close();
    });
    // Check for Gramophone share hash after app is synced
    effect(() => {
      const state = this.$clientState();
      if (state === (RoonState.SYNC as string) && !this._hasCheckedGramophoneHash) {
        this._hasCheckedGramophoneHash = true;
        // Delay to ensure UI is ready
        setTimeout(() => {
          this._gramophoneShareService.checkHashAndOpenDialog();
        }, 100);
      }
    });
  }
}
