import { CommandExecutor, FoundZone, SeekCommand } from "@model";

export const executor: CommandExecutor<SeekCommand, FoundZone> = (command, foundZone) => {
  const { zone, server } = foundZone;
  const how = command.data.how ?? "absolute";
  return server.services.RoonApiTransport.seek(zone, how, command.data.seconds);
};
