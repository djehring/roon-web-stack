import { logger } from "@infrastructure";
import { CommandExecutor, FoundZone, TransferZoneCommand } from "@model";

const SETTLE_MS = 750;

/**
 * Roon moves the queue to the destination, but has been seen to leave the
 * source room playing as well. A transfer means the music leaves the source,
 * so once Roon has had a moment to update, a source that still plays is stopped.
 */
export const executor: CommandExecutor<TransferZoneCommand, FoundZone> = async (command, foundZone) => {
  const { zone, server } = foundZone;
  const transport = server.services.RoonApiTransport;
  const toZone = transport.zone_by_zone_id(command.data.to_zone_id);
  if (!toZone) throw new Error(`'${command.data.to_zone_id}' is not a valid zone_id`);
  await transport.transfer_zone(zone, toZone);
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const source = transport.zone_by_zone_id(zone.zone_id);
  const stillPlaying = source?.state === "playing" || source?.state === "loading";
  logger.info(
    { from: zone.display_name, to: toZone.display_name, sourceState: source?.state ?? "gone", stillPlaying },
    "Zone transfer completed"
  );
  if (source && stillPlaying) {
    try {
      await transport.control(source, source.is_pause_allowed ? "pause" : "stop");
    } catch (error) {
      // The transfer itself succeeded; a source that will not stop is reported, not failed.
      logger.warn({ from: zone.display_name, error }, "The source room kept playing after a transfer");
    }
  }
};
