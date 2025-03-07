import {
  FoundZone,
  InternalCommandExecutor,
  InternalCommandType,
  Output,
  QueueBotCommand,
  RoonApiTransport,
} from "@model";
import { awaitAll } from "./command-executor-utils";

export const internalExecutor: InternalCommandExecutor<QueueBotCommand, FoundZone> = async (command, foundZone) => {
  const { server, zone } = foundZone;
  if (zone.state === "playing") {
    await server.services.RoonApiTransport.control(zone, zone.is_next_allowed ? "pause" : "stop");
    if (zone.is_next_allowed) {
      await server.services.RoonApiTransport.control(zone, "next");
      await server.services.RoonApiTransport.control(zone, "stop");
    }
  }
  await standbyPromise(command.type, zone.outputs, server.services.RoonApiTransport);
};

const standbyPromise = async (
  commandType: InternalCommandType,
  outputs: Output[],
  roonApiTransport: RoonApiTransport
): Promise<void> => {
  if (commandType === InternalCommandType.STANDBY_NEXT && outputs.length > 0) {
    const promises = outputs
      .flatMap((output) => {
        const controls = output.source_controls ?? [];
        return controls
          .filter((sco) => sco.supports_standby)
          .map((sco) => ({
            control_key: sco.control_key,
            output,
          }));
      })
      .map((standby) => roonApiTransport.standby(standby.output, { control_key: standby.control_key }));
    await awaitAll(promises);
  }
};
