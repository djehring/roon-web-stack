import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@infrastructure";

describe("pairing-store.ts test suite", () => {
  let pairingFile: string;
  let pairingStore: typeof import("./pairing-store").pairingStore;

  beforeEach(() => {
    pairingFile = path.join(os.tmpdir(), `roon-pairing-${process.pid}-${Date.now()}-${Math.random()}.json`);
    process.env.PAIRING_FILE = pairingFile;
    jest.isolateModules((): void => {
      void import("./pairing-store")
        .then((module) => {
          pairingStore = module.pairingStore;
        })
        .catch((err: unknown) => {
          logger.error(err);
        });
    });
  });

  afterEach(() => {
    fs.rmSync(pairingFile, { force: true });
    delete process.env.PAIRING_FILE;
    jest.resetModules();
  });

  it("loadOrCreate should persist a 6-digit PIN", () => {
    const pin = pairingStore.loadOrCreate();
    expect(pin).toMatch(/^\d{6}$/);
    const raw = fs.readFileSync(pairingFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual({ pin });
  });

  it("loadOrCreate should reuse a previously persisted PIN", () => {
    fs.mkdirSync(path.dirname(pairingFile), { recursive: true });
    fs.writeFileSync(pairingFile, JSON.stringify({ pin: "482193" }), "utf8");
    expect(pairingStore.loadOrCreate()).toBe("482193");
    expect(pairingStore.read()).toBe("482193");
  });

  it("rotate should write a different PIN", () => {
    const first = pairingStore.loadOrCreate();
    const second = pairingStore.rotate();
    expect(second).toMatch(/^\d{6}$/);
    expect(second).not.toBe(first);
    const raw = fs.readFileSync(pairingFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual({ pin: second });
  });

  it("matches should accept the current PIN and reject others", () => {
    const pin = pairingStore.loadOrCreate();
    const wrong = pin === "000000" ? "111111" : "000000";
    expect(pairingStore.matches(pin)).toBe(true);
    expect(pairingStore.matches(wrong)).toBe(false);
    expect(pairingStore.matches("12")).toBe(false);
  });
});
