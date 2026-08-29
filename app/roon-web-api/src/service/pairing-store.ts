import { randomInt, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const PIN_LENGTH = 6;
const PIN_MAX = 1_000_000;

export class InvalidPairingPinError extends Error {
  constructor() {
    super("invalid pairing pin");
    this.name = "InvalidPairingPinError";
  }
}

interface PairingFile {
  pin: string;
}

const pairingFilePath = (): string => {
  if (process.env.PAIRING_FILE) {
    return process.env.PAIRING_FILE;
  }
  return path.join(process.cwd(), "config", "pairing.json");
};

const isPin = (value: unknown): value is string => {
  return typeof value === "string" && /^\d{6}$/.test(value);
};

const isPairingFile = (value: unknown): value is PairingFile => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("pin" in value)) {
    return false;
  }
  return isPin(value.pin);
};

const generatePin = (): string => {
  return String(randomInt(0, PIN_MAX)).padStart(PIN_LENGTH, "0");
};

const readPersistedPin = (): string | undefined => {
  try {
    const raw = fs.readFileSync(pairingFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isPairingFile(parsed)) {
      return parsed.pin;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const writePersistedPin = (pin: string): void => {
  const dir = path.dirname(pairingFilePath());
  fs.mkdirSync(dir, { recursive: true });
  const payload: PairingFile = { pin };
  fs.writeFileSync(pairingFilePath(), JSON.stringify(payload), "utf8");
};

class InternalPairingStore {
  private pin?: string;

  loadOrCreate = (): string => {
    const existing = readPersistedPin();
    if (existing) {
      this.pin = existing;
      return existing;
    }
    const generated = generatePin();
    writePersistedPin(generated);
    this.pin = generated;
    return generated;
  };

  read = (): string => {
    if (this.pin === undefined) {
      return this.loadOrCreate();
    }
    return this.pin;
  };

  rotate = (): string => {
    const generated = generatePin();
    writePersistedPin(generated);
    this.pin = generated;
    return generated;
  };

  matches = (pin: string): boolean => {
    const expected = Buffer.from(this.read(), "utf8");
    const offered = Buffer.from(pin, "utf8");
    if (expected.length !== offered.length) {
      return false;
    }
    return timingSafeEqual(expected, offered);
  };
}

export const pairingStore: InternalPairingStore = new InternalPairingStore();
