import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { roon } from "@infrastructure";
import type { RoonServer } from "@model";
import { historyService, startHistory, stopHistory } from "./service";

jest.mock("@infrastructure", () => ({
  roon: { onZones: jest.fn(), onServerPaired: jest.fn(), onServerLost: jest.fn() },
}));

test("revoked and replaced Core subscriptions cannot crash or disconnect the active recorder", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "roon-history-lifecycle-"));
  const previousFile = process.env.HISTORY_FILE;
  process.env.HISTORY_FILE = path.join(directory, "history.json");
  try {
    await startHistory();
    const paired = jest.mocked(roon.onServerPaired).mock.calls[0][0];
    const lost = jest.mocked(roon.onServerLost).mock.calls[0][0];
    const zones = jest.mocked(roon.onZones).mock.calls[0][0];
    const oldCore = { core_id: "core" } as RoonServer;
    const revoked = Proxy.revocable(oldCore, {});
    paired(revoked.proxy);
    zones(revoked.proxy, "Subscribed", { zones: [] });
    expect(historyService().recorder.connected).toBe(true);
    lost(oldCore);
    revoked.revoke();
    expect(() => zones(revoked.proxy, "Unsubscribed", {})).not.toThrow();
    expect(historyService().recorder.connected).toBe(false);

    const replacement = { core_id: "core" } as RoonServer;
    paired(replacement);
    zones(replacement, "Subscribed", { zones: [] });
    zones(revoked.proxy, "Unsubscribed", {});
    zones(revoked.proxy, "Changed", {});
    expect(historyService().recorder.connected).toBe(true);
    zones(replacement, "Unsubscribed", {});
    expect(historyService().recorder.connected).toBe(false);
  } finally {
    await stopHistory();
    if (previousFile === undefined) delete process.env.HISTORY_FILE;
    else process.env.HISTORY_FILE = previousFile;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
