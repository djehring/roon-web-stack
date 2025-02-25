import { deepEqual } from "fast-equals";
import { NgTemplateOutlet } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, Input, Signal, TemplateRef } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { ZoneSelectorComponent } from "@components/zone-selector/zone-selector.component";
import { Command, CommandType } from "@model";
import { DisplayMode, ZoneCommands, ZoneCommandState } from "@model/client";
import { NgxSpatialNavigableStarterDirective } from "@nihilux/ngx-spatial-navigable";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-zone-commands",
  imports: [
    MatButtonModule,
    MatIconModule,
    NgTemplateOutlet,
    NgxSpatialNavigableStarterDirective,
    ZoneSelectorComponent,
  ],
  templateUrl: "./zone-commands.component.html",
  styleUrl: "./zone-commands.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZoneCommandsComponent {
  private readonly _roonService: RoonService;
  @Input({ required: true }) $zoneCommands!: Signal<ZoneCommands>;
  @Input({ required: false }) zoneVolume?: TemplateRef<{ class: string }>;
  readonly $isSmallScreen: Signal<boolean>;

  constructor() {
    this._roonService = inject(RoonService);
    const settingsService = inject(SettingsService);
    const $displayMode = settingsService.displayMode();
    const $isSmallScreen = settingsService.isSmallScreen();
    this.$isSmallScreen = computed(
      () => {
        return $isSmallScreen() || $displayMode() === DisplayMode.COMPACT;
      },
      {
        equal: deepEqual,
      }
    );
  }

  onCommandClick(clickedCommand: string) {
    let commandType: CommandType | undefined;
    switch (clickedCommand) {
      case "previousTrack":
        commandType = CommandType.PREVIOUS;
        break;
      case "play":
        commandType = CommandType.PLAY;
        break;
      case "pause":
        commandType = CommandType.PAUSE;
        break;
      case "nextTrack":
        commandType = CommandType.NEXT;
        break;
      default:
        commandType = undefined;
        break;
    }
    if (commandType) {
      const zoneCommands = this.$zoneCommands();
      const zone_id = zoneCommands.zoneId;
      if (
        (commandType === CommandType.PREVIOUS || commandType === CommandType.NEXT) &&
        zoneCommands.pause === ZoneCommandState.ACTIVE
      ) {
        this._roonService.command({
          type: CommandType.PAUSE,
          data: {
            zone_id,
          },
        });
        this._roonService.command({
          type: commandType,
          data: {
            zone_id,
          },
        });
        this._roonService.command({
          type: CommandType.PLAY,
          data: {
            zone_id,
          },
        });
      } else {
        const command: Command = {
          type: commandType,
          data: {
            zone_id,
          },
        };
        this._roonService.command(command);
      }
    }
  }
}
