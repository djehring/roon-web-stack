import { CommandType, FoundZone, RoonApiTransport, RoonServer, TransferZoneCommand, Zone } from "@model";
import { executor } from "./transfer-zone-command-executor";

jest.mock("@infrastructure", () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));

const zone_id = "zone_id";
const to_zone_id = "to_zone_id";
const zone = { zone_id, display_name: "Office" } as unknown as Zone;
const to_zone = { zone_id: to_zone_id, display_name: "Kitchen" } as unknown as Zone;
const command: TransferZoneCommand = { type: CommandType.TRANSFER_ZONE, data: { zone_id, to_zone_id } };

describe("transfer-zone-command-executor.ts test suite", () => {
  let transferZoneApi: jest.Mock;
  let controlApi: jest.Mock;
  let zones: Record<string, Partial<Zone> | undefined>;
  let foundZone: FoundZone;
  beforeEach(() => {
    jest.useFakeTimers();
    transferZoneApi = jest.fn().mockResolvedValue(undefined);
    controlApi = jest.fn().mockResolvedValue(undefined);
    zones = { [to_zone_id]: to_zone, [zone_id]: { ...zone, state: "stopped" } };
    const transport = {
      transfer_zone: transferZoneApi,
      control: controlApi,
      zone_by_zone_id: jest.fn((id: string) => zones[id] ?? null),
    } as unknown as RoonApiTransport;
    foundZone = { zone, server: { services: { RoonApiTransport: transport } } as unknown as RoonServer };
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  const run = async () => {
    const result = executor(command, foundZone);
    result.catch(() => undefined);
    await jest.runAllTimersAsync();
    return result;
  };

  it("transfers the queue and leaves a source that Roon has stopped alone", async () => {
    await expect(run()).resolves.toBeUndefined();
    expect(transferZoneApi).toHaveBeenCalledWith(zone, to_zone);
    expect(controlApi).not.toHaveBeenCalled();
  });

  it.each(["playing", "loading"])("pauses a source that is still %s after the transfer", async (state) => {
    zones[zone_id] = { ...zone, state, is_pause_allowed: true } as Partial<Zone>;
    await expect(run()).resolves.toBeUndefined();
    expect(controlApi).toHaveBeenCalledWith(zones[zone_id], "pause");
  });

  it("stops a source that cannot be paused, such as live radio", async () => {
    zones[zone_id] = { ...zone, state: "playing", is_pause_allowed: false } as Partial<Zone>;
    await run();
    expect(controlApi).toHaveBeenCalledWith(zones[zone_id], "stop");
  });

  it("still reports the transfer as done when the source will not stop or has gone", async () => {
    zones[zone_id] = { ...zone, state: "playing", is_pause_allowed: true } as Partial<Zone>;
    controlApi.mockRejectedValue(new Error("refused"));
    await expect(run()).resolves.toBeUndefined();
    zones[zone_id] = undefined;
    controlApi.mockClear();
    await expect(run()).resolves.toBeUndefined();
    expect(controlApi).not.toHaveBeenCalled();
  });

  it("rejects an unknown destination without transferring", async () => {
    zones[to_zone_id] = undefined;
    await expect(run()).rejects.toEqual(new Error(`'${to_zone_id}' is not a valid zone_id`));
    expect(transferZoneApi).not.toHaveBeenCalled();
  });

  it("rejects when Roon refuses the transfer, without touching the source", async () => {
    const error = new Error("error!");
    transferZoneApi.mockRejectedValue(error);
    await expect(run()).rejects.toEqual(error);
    expect(controlApi).not.toHaveBeenCalled();
  });
});
