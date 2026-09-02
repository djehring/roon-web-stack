import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@infrastructure";

describe("openai-key-store.ts test suite", () => {
  let keyFile: string;
  let openaiKeyStore: typeof import("./openai-key-store").openaiKeyStore;

  beforeEach(() => {
    keyFile = path.join(os.tmpdir(), `roon-openai-${process.pid}-${Date.now()}-${Math.random()}.json`);
    process.env.OPENAI_KEY_FILE = keyFile;
    jest.isolateModules((): void => {
      void import("./openai-key-store")
        .then((module) => {
          openaiKeyStore = module.openaiKeyStore;
        })
        .catch((err: unknown) => {
          logger.error(err);
        });
    });
  });

  afterEach(() => {
    fs.rmSync(keyFile, { force: true });
    delete process.env.OPENAI_KEY_FILE;
    jest.resetModules();
  });

  it("read should return empty when no file exists", () => {
    expect(openaiKeyStore.read()).toBe("");
  });

  it("save should persist a trimmed key", () => {
    openaiKeyStore.save("  sk-user  ");
    expect(openaiKeyStore.read()).toBe("sk-user");
    const raw = fs.readFileSync(keyFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    expect(parsed).toEqual({ apiKey: "sk-user" });
  });

  it("save should delete the file when the key is cleared", () => {
    openaiKeyStore.save("sk-user");
    openaiKeyStore.save("  ");
    expect(openaiKeyStore.read()).toBe("");
    expect(fs.existsSync(keyFile)).toBe(false);
  });
});
