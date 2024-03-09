import { MockBuilder, MockRender } from "ng-mocks";
import { signal, WritableSignal } from "@angular/core";
import { ComponentFixture } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import { Command, OutputDescription, ZoneState } from "@model";
import { CommandCallback, OutputCallback } from "@model/client";
import { RoonService } from "@services/roon.service";
import { SettingsService } from "@services/settings.service";
import { ZoneGroupingDialogComponent } from "./zone-grouping-dialog.component";

describe("ZoneGroupingDialogComponent", () => {
  let $outputs: WritableSignal<OutputDescription[]>;
  let $zone: WritableSignal<ZoneState>;
  let commands: Command[];
  let callbacks: CommandCallback[];
  let outputCallbacks: OutputCallback[];
  let roonService: {
    outputs: jest.Mock;
    zoneState: jest.Mock;
    registerOutputCallback: jest.Mock;
    command: jest.Mock;
  };
  let $displayedZoneId: WritableSignal<string>;
  let settingsService: {
    displayedZoneId: jest.Mock;
    saveDisplayedZoneId: jest.Mock;
  };
  let closeDialog: jest.Mock;
  let component: ZoneGroupingDialogComponent;
  let fixture: ComponentFixture<ZoneGroupingDialogComponent>;

  beforeEach(async () => {
    $outputs = signal(OUTPUTS);
    $zone = signal({
      outputs: [
        {
          output_id: OUTPUTS[0].output_id,
          display_name: OUTPUTS[0].display_name,
          can_group_with_output_ids: [OUTPUTS[0].output_id, OUTPUTS[1].output_id],
        },
      ],
    } as unknown as ZoneState);
    commands = [];
    callbacks = [];
    outputCallbacks = [];
    roonService = {
      zoneState: jest.fn().mockImplementation(() => $zone),
      command: jest.fn().mockImplementation((c: Command, callback: CommandCallback) => {
        commands.push(c);
        callbacks.push(callback);
      }),
      registerOutputCallback: jest.fn().mockImplementation((oc: OutputCallback) => outputCallbacks.push(oc)),
      outputs: jest.fn().mockImplementation(() => $outputs),
    };
    $displayedZoneId = signal("zone_id");
    settingsService = {
      displayedZoneId: jest.fn().mockImplementation(() => $displayedZoneId),
      saveDisplayedZoneId: jest.fn().mockImplementation((zone_id: string) => {
        $displayedZoneId.set(zone_id);
      }),
    };
    await MockBuilder(ZoneGroupingDialogComponent)
      .mock(RoonService, roonService as Partial<RoonService>)
      .mock(SettingsService, settingsService as Partial<SettingsService>)
      .mock(MatDialogRef<ZoneGroupingDialogComponent>, {
        close: closeDialog,
      });

    fixture = MockRender(ZoneGroupingDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});

const OUTPUTS: OutputDescription[] = [
  {
    output_id: "output_id",
    display_name: "display_name",
    zone_id: "zone_id",
  },
  {
    output_id: "other_output_id",
    display_name: "other_display_name",
    zone_id: "other_zone_id",
  },
  {
    output_id: "yet_another_output_id",
    display_name: "yet_another_display_name",
    zone_id: "yet_another_zone_id",
  },
];
