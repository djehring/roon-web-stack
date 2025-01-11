import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from "@angular/cdk/drag-drop";
import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, Signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButton, MatIconButton } from "@angular/material/button";
import { MatOptionModule } from "@angular/material/core";
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from "@angular/material/dialog";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIcon } from "@angular/material/icon";
import { MatMenu, MatMenuItem, MatMenuTrigger } from "@angular/material/menu";
import { MatSelectModule } from "@angular/material/select";
import { MatTab, MatTabContent, MatTabGroup } from "@angular/material/tabs";
import { CustomActionsManagerComponent } from "@components/custom-actions-manager/custom-actions-manager.component";
import { ZoneSelectorComponent } from "@components/zone-selector/zone-selector.component";
import {
  Action,
  ChosenTheme,
  CustomActionsManagerDialogConfig,
  CustomActionsManagerDialogConfigBigFonts,
  DisplayMode,
  DisplayModesData,
  SettingsDialogConfig,
  SettingsDialogConfigBigFonts,
  Theme,
  Themes,
} from "@model/client";
import {
  NgxSpatialNavigableContainerDirective,
  NgxSpatialNavigableElementDirective,
  NgxSpatialNavigableService,
  NgxSpatialNavigableStarterDirective,
} from "@nihilux/ngx-spatial-navigable";
import { DialogService } from "@services/dialog.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-settings-dialog",
  standalone: true,
  imports: [
    CommonModule,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    MatButton,
    MatDialogActions,
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTab,
    MatTabContent,
    MatTabGroup,
    NgxSpatialNavigableContainerDirective,
    NgxSpatialNavigableStarterDirective,
    ZoneSelectorComponent,
    NgxSpatialNavigableElementDirective,
    MatExpansionModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule,
    MatOptionModule,
  ],
  templateUrl: "./settings-dialog.component.html",
  styleUrl: "./settings-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDialogComponent implements OnInit {
  private readonly _dialogRef: MatDialogRef<SettingsDialogComponent>;
  private readonly _dialogService: DialogService;
  private readonly _settingsService: SettingsService;
  private readonly _spatialNavigableService: NgxSpatialNavigableService;
  private readonly _$displayMode: Signal<DisplayMode>;
  readonly $actions: Signal<Action[]>;
  readonly $availableActions: Signal<Action[]>;
  readonly $chosenTheme: Signal<Theme>;
  readonly $isBigFonts: Signal<boolean>;
  readonly $isOneColumn: Signal<boolean>;
  readonly $isSmallScreen: Signal<boolean>;
  readonly $layoutClass: Signal<string>;
  readonly $displayMode: Signal<string>;
  readonly displayModes: { id: DisplayMode; label: string }[];
  readonly version: string;
  readonly selectedTab: number;
  audioDevices: MediaDeviceInfo[] = [];
  selectedMicrophoneId = "";

  constructor() {
    const data = inject(MAT_DIALOG_DATA) as { selectedTab: number };
    this._dialogRef = inject<MatDialogRef<SettingsDialogComponent>>(MatDialogRef);
    this._dialogService = inject(DialogService);
    this._settingsService = inject(SettingsService);
    this._spatialNavigableService = inject(NgxSpatialNavigableService);
    effect(() => {
      for (const dmData of Object.values(DisplayModesData)) {
        this._dialogRef.removePanelClass(dmData.class);
      }
      const config = this.$isBigFonts() ? SettingsDialogConfigBigFonts : SettingsDialogConfig;
      this._dialogRef.updateSize(config.width, config.height);
      this._dialogRef.addPanelClass(this.$layoutClass());
    });
    this.displayModes = [];
    for (const [id, dmData] of Object.entries(DisplayModesData)) {
      if (dmData.label) {
        this.displayModes.push({
          id: id as DisplayMode,
          label: dmData.label,
        });
      }
    }
    this._$displayMode = this._settingsService.displayMode();
    this.$displayMode = computed(() => DisplayModesData[this._$displayMode()].label ?? "");
    this.$chosenTheme = computed(() => {
      const chosenTheme = this._settingsService.chosenTheme()() as ChosenTheme;
      return Themes.find((t) => t.id === chosenTheme) ?? Themes[0];
    });
    this.$actions = this._settingsService.actions();
    this.$availableActions = this._settingsService.availableActions();
    this.$isBigFonts = this._settingsService.isBigFonts();
    this.$isSmallScreen = this._settingsService.isSmallScreen();
    this.$isOneColumn = this._settingsService.isOneColumn();
    this.$layoutClass = this._settingsService.displayModeClass();
    this.selectedTab = data.selectedTab;
    this.version = inject(RoonService).version();
  }

  ngOnInit(): void {
    void this.loadAudioDevices();
  }

  private async loadAudioDevices(): Promise<void> {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter((device) => device.kind === "audioinput");

      const savedDeviceId = localStorage.getItem("preferredMicrophoneId");
      if (savedDeviceId) {
        this.selectedMicrophoneId = savedDeviceId;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Error loading audio devices:", err);
    }
  }

  onMicrophoneChange(): void {
    localStorage.setItem("preferredMicrophoneId", this.selectedMicrophoneId);
  }

  chosenThemes() {
    return Themes;
  }

  chosenTheme() {
    return this.$chosenTheme;
  }

  setChosenTheme(theme: ChosenTheme) {
    this._settingsService.saveChosenTheme(theme);
  }

  displayMode() {
    return this._settingsService.displayMode();
  }

  setDisplayMode(displayMode: DisplayMode) {
    this._settingsService.saveDisplayMode(displayMode);
  }

  onSave() {
    this._dialogService.close();
  }

  onReload() {
    this.onSave();
    window.location.reload();
  }

  addAction(action: Action) {
    const actions = this.$actions();
    actions.push(action);
    this._settingsService.saveActions(actions);
  }

  removeAction(action: Action) {
    const actions = this.$actions();
    const index = actions.indexOf(action);
    if (index >= 0) {
      actions.splice(index, 1);
    }
    this._settingsService.saveActions(actions);
  }

  onActionsReordered(dropEvent: CdkDragDrop<Action[]>) {
    const actions = this.$actions();
    moveItemInArray(actions, dropEvent.previousIndex, dropEvent.currentIndex);
    this._settingsService.saveActions(actions);
  }

  openCustomActionsManager() {
    const config = this.$isBigFonts() ? CustomActionsManagerDialogConfigBigFonts : CustomActionsManagerDialogConfig;
    this._dialogService.open(CustomActionsManagerComponent, {
      ...config,
      data: {
        reset: true,
      },
    });
  }

  onMenOpen() {
    this._spatialNavigableService.suspendSpatialNavigation();
  }

  onMenuClosed() {
    this._spatialNavigableService.resumeSpatialNavigation();
  }

  getCurrentMicrophoneLabel(): string {
    const device = this.audioDevices.find((d) => d.deviceId === this.selectedMicrophoneId);
    return device?.label || "Default Microphone";
  }

  setMicrophone(deviceId: string): void {
    this.selectedMicrophoneId = deviceId;
    this.onMicrophoneChange();
  }
}
