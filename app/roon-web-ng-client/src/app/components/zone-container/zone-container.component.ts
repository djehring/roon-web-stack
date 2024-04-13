import { deepEqual } from "fast-equals";
import { Subscription } from "rxjs";
import { animate, style, transition, trigger } from "@angular/animations";
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  OnDestroy,
  Signal,
  signal,
  WritableSignal,
} from "@angular/core";
import { RoonImageComponent } from "@components/roon-image/roon-image.component";
import { ZoneActionsComponent } from "@components/zone-actions/zone-actions.component";
import { ZoneCommandsComponent } from "@components/zone-commands/zone-commands.component";
import { ZoneCurrentTrackComponent } from "@components/zone-current-track/zone-current-track.component";
import { ZoneProgressionComponent } from "@components/zone-progression/zone-progression.component";
import { ZoneQueueComponent } from "@components/zone-queue/zone-queue.component";
import { ZoneSelectorComponent } from "@components/zone-selector/zone-selector.component";
import { Output, ZoneState } from "@model";
import {
  DEFAULT_ZONE_PROGRESSION,
  DisplayMode,
  EMPTY_TRACK,
  TrackDisplay,
  TrackImage,
  ZoneCommands,
  ZoneCommandState,
  ZoneProgression,
} from "@model/client";
import { ResizeService } from "@services/resize.service";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";

@Component({
  selector: "nr-zone-container",
  standalone: true,
  imports: [
    RoonImageComponent,
    ZoneActionsComponent,
    ZoneCommandsComponent,
    ZoneCurrentTrackComponent,
    ZoneProgressionComponent,
    ZoneQueueComponent,
    ZoneSelectorComponent,
  ],
  templateUrl: "./zone-container.component.html",
  styleUrl: "./zone-container.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger("hideQueueTrack", [
      transition(":leave", [
        style({
          opacity: 1,
          flexGrow: 1,
        }),
        animate(
          "0.2s ease-out",
          style({
            opacity: 0,
            flexGrow: 0,
          })
        ),
      ]),
    ]),
  ],
})
export class ZoneContainerComponent implements OnDestroy, AfterViewInit {
  private readonly _resizeService: ResizeService;
  private readonly _settingsService: SettingsService;
  private readonly _zoneContainerElement: ElementRef;
  private readonly _changeDetector: ChangeDetectorRef;
  private readonly _$zone: Signal<ZoneState>;
  private readonly _$imageSize: WritableSignal<number>;
  private _resizeSubscription?: Subscription;
  readonly $trackDisplay: Signal<TrackDisplay>;
  readonly $zoneCommands: Signal<ZoneCommands>;
  readonly $zoneProgression: Signal<ZoneProgression>;
  readonly $zoneOutputs: Signal<Output[]>;
  readonly $image: Signal<TrackImage>;
  readonly $isOneColumn: Signal<boolean>;
  readonly $isCompact: Signal<boolean>;
  readonly $isWide: Signal<boolean>;
  readonly $displayQueueTrack: Signal<boolean>;
  hasBeenDisplayed: boolean;
  protected readonly EMPTY_TRACK = EMPTY_TRACK;

  constructor(
    roonService: RoonService,
    settingsService: SettingsService,
    elementRef: ElementRef,
    resizeService: ResizeService,
    changeDetector: ChangeDetectorRef
  ) {
    this._settingsService = settingsService;
    this._zoneContainerElement = elementRef;
    this._resizeService = resizeService;
    this._changeDetector = changeDetector;
    this._$zone = roonService.zoneState(settingsService.displayedZoneId());
    this.$trackDisplay = computed(
      () => {
        const { image_key, title, artist, disk } = this._$zone().nice_playing?.track ?? EMPTY_TRACK;
        return {
          image_key,
          title,
          artist,
          disk,
        };
      },
      {
        equal: deepEqual,
      }
    );
    this.$zoneCommands = computed(
      () => {
        const zs = this._$zone();
        const previousAlbum = ZoneCommandState.ABSENT;
        const previousTrack = zs.is_previous_allowed ? ZoneCommandState.ACTIVE : ZoneCommandState.DISABLED;
        let loading: ZoneCommandState;
        let pause: ZoneCommandState;
        let play: ZoneCommandState;
        switch (zs.state) {
          case "paused":
          case "stopped":
            loading = ZoneCommandState.ABSENT;
            pause = ZoneCommandState.ABSENT;
            play = zs.is_play_allowed ? ZoneCommandState.ACTIVE : ZoneCommandState.DISABLED;
            break;
          case "loading":
            loading = ZoneCommandState.ACTIVE;
            pause = ZoneCommandState.ABSENT;
            play = ZoneCommandState.ABSENT;
            break;
          case "playing":
            loading = ZoneCommandState.ABSENT;
            pause = zs.is_pause_allowed ? ZoneCommandState.ACTIVE : ZoneCommandState.ABSENT;
            play = ZoneCommandState.ABSENT;
            break;
        }
        const nextTrack = zs.is_next_allowed ? ZoneCommandState.ACTIVE : ZoneCommandState.DISABLED;
        const nextAlbum = ZoneCommandState.ABSENT;
        return {
          zoneId: zs.zone_id,
          previousAlbum,
          previousTrack,
          loading,
          play,
          pause,
          nextTrack,
          nextAlbum,
        };
      },
      {
        equal: deepEqual,
      }
    );
    this.$zoneProgression = computed(() => {
      const track = this._$zone().nice_playing?.track ?? EMPTY_TRACK;
      if (track.length && track.seek_position) {
        return {
          length: track.length,
          position: track.seek_position,
          percentage: track.seek_percentage ?? 0,
        };
      }
      return DEFAULT_ZONE_PROGRESSION;
    });
    this.$zoneOutputs = computed(
      () => {
        return this._$zone().outputs;
      },
      {
        equal: deepEqual,
      }
    );
    this._$imageSize = signal(-1);
    this.$image = computed(
      () => {
        const src = this.$trackDisplay().image_key ?? "";
        const size = this._$imageSize();
        const isReady = src.length > 0 && size !== -1;
        return {
          src,
          size,
          isReady,
        };
      },
      {
        equal: deepEqual,
      }
    );
    this.$isOneColumn = this._settingsService.isOneColumn();
    this.$isCompact = computed(() => {
      return this._settingsService.displayMode()() === DisplayMode.COMPACT;
    });
    this.$isWide = computed(() => {
      return this._settingsService.displayMode()() === DisplayMode.WIDE;
    });
    this.$displayQueueTrack = this._settingsService.displayQueueTrack();
    this.hasBeenDisplayed = false;
  }

  ngAfterViewInit(): void {
    const zoneDisplayDiv = this._zoneContainerElement.nativeElement as HTMLDivElement;
    const zoneImageDiv = zoneDisplayDiv.getElementsByClassName("zone-image")[0] as HTMLDivElement;
    setTimeout(() => {
      this._$imageSize.set(Math.min(zoneImageDiv.offsetWidth - 20, zoneImageDiv.offsetHeight - 20));
    }, 5);
    let firstResize = true;
    this._resizeSubscription = this._resizeService.observeElement(zoneImageDiv).subscribe((resizeEntry) => {
      if (!firstResize) {
        const borderBox = resizeEntry.borderBoxSize[0];
        this._$imageSize.set(Math.min(borderBox.inlineSize - 20, borderBox.blockSize - 20));
        this._changeDetector.detectChanges();
      } else {
        firstResize = false;
      }
    });
    this.hasBeenDisplayed = true;
  }

  ngOnDestroy() {
    this._resizeSubscription?.unsubscribe();
  }
}
