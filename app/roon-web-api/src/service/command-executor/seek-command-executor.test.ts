import { CommandType, FoundZone, RoonApiTransport, RoonServer, SeekCommand, Zone } from "@model";
import { executor } from "./seek-command-executor";

describe("seek-command-executor test suite", () => {
  let seekApi: jest.Mock;
  let server: RoonServer;
  let foundZone: FoundZone;
  const zone_id = "zone_id";
  const zone = { zone_id } as unknown as Zone;

  beforeEach(() => {
    seekApi = jest.fn().mockImplementation(() => Promise.resolve());
    const roonApiTransport: RoonApiTransport = {
      seek: seekApi,
    } as unknown as RoonApiTransport;
    server = {
      services: {
        RoonApiTransport: roonApiTransport,
      },
    } as unknown as RoonServer;
    foundZone = {
      zone,
      server,
    };
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("executor should call RoonApiTransport#seek with absolute how by default", async () => {
    const command: SeekCommand = {
      type: CommandType.SEEK,
      data: {
        zone_id,
        seconds: 42,
      },
    };
    await expect(executor(command, foundZone)).resolves.toBeUndefined();
    expect(seekApi).toHaveBeenCalledWith(zone, "absolute", 42);
  });

  it("executor should pass relative how when provided", async () => {
    const command: SeekCommand = {
      type: CommandType.SEEK,
      data: {
        zone_id,
        seconds: -5,
        how: "relative",
      },
    };
    await expect(executor(command, foundZone)).resolves.toBeUndefined();
    expect(seekApi).toHaveBeenCalledWith(zone, "relative", -5);
  });

  it("executor should reject when RoonApiTransport#seek rejects", async () => {
    const error = new Error("boom");
    seekApi.mockImplementation(() => Promise.reject(error));
    const command: SeekCommand = {
      type: CommandType.SEEK,
      data: {
        zone_id,
        seconds: 10,
      },
    };
    await expect(executor(command, foundZone)).rejects.toBe(error);
  });
});
