import { ChangeDetectionStrategy, Component, computed, inject, Signal } from "@angular/core";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogActions, MatDialogContent, MatDialogTitle } from "@angular/material/dialog";
import { MatIcon } from "@angular/material/icon";
import { MatTab, MatTabContent, MatTabGroup } from "@angular/material/tabs";
import { CustomActionEditorComponent } from "@components/custom-action-editor/custom-action-editor.component";
import { SettingsDialogComponent } from "@components/settings-dialog/settings-dialog.component";
import { CustomAction, SettingsDialogConfig, SettingsDialogConfigBigFonts } from "@model/client";
import {
  NgxSpatialNavigableContainerDirective,
  NgxSpatialNavigableStarterDirective,
} from "@nihilux/ngx-spatial-navigable";
import { CustomActionsService } from "@services/custom-actions.service";
import { DialogService } from "@services/dialog.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-custom-actions-manager",
  imports: [
    CustomActionEditorComponent,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatIconButton,
    MatTab,
    MatTabContent,
    MatTabGroup,
    NgxSpatialNavigableContainerDirective,
    NgxSpatialNavigableStarterDirective,
  ],
  templateUrl: "./custom-actions-manager.component.html",
  styleUrl: "./custom-actions-manager.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomActionsManagerComponent {
  private readonly _dialogService: DialogService;
  private readonly _customActionsService: CustomActionsService;
  private readonly _roonService: RoonService;
  private readonly _$isBigFont: Signal<boolean>;
  readonly $isEditing: Signal<boolean>;
  readonly $customActions: Signal<CustomAction[]>;
  readonly $selectedTab: Signal<number>;
  readonly $saveDisabled: Signal<boolean>;

  constructor() {
    const data = inject(MAT_DIALOG_DATA) as { reset: boolean };
    this._dialogService = inject(DialogService);
    this._customActionsService = inject(CustomActionsService);
    this._roonService = inject(RoonService);
    this._$isBigFont = inject(SettingsService).isBigFonts();
    this.$isEditing = this._customActionsService.isEditing();
    this.$customActions = computed(() =>
      this._customActionsService
        .customActions()()
        .sort((ca0, ca1) => ca0.button.label.localeCompare(ca1.button.label))
    );
    this.$selectedTab = computed(() => (this.$isEditing() ? 1 : 0));
    this.$saveDisabled = computed(() => !this._customActionsService.isValid()());
    if (data.reset) {
      this._customActionsService.cancelEdition();
    }
  }

  onSave() {
    if (this.$isEditing()) {
      const command = this._customActionsService.saveAction();
      if (command !== undefined) {
        this._roonService.command(command);
        this._customActionsService.cancelEdition();
      }
    } else {
      const config = this._$isBigFont() ? SettingsDialogConfigBigFonts : SettingsDialogConfig;
      this._dialogService.open(SettingsDialogComponent, {
        ...config,
        data: {
          selectedTab: 1,
        },
      });
    }
  }

  onCancel() {
    this._customActionsService.cancelEdition();
  }

  createCustomAction() {
    this._customActionsService.createAction();
  }

  deleteCustomAction(customActionId: string) {
    const command = this._customActionsService.deleteAction(customActionId);
    this._roonService.command(command);
  }

  editCustomAction(customAction: CustomAction) {
    this._customActionsService.editAction(customAction);
  }
}
