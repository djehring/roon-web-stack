import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isMissingOpenAIKeyError, recognizeAlbumFromImage, resolveOpenAIApiKey } from "./chatgpt";

describe("chatgpt OpenAI key resolution", () => {
  const originalEnv = process.env.OPENAI_API_KEY;
  const originalFile = process.env.OPENAI_KEY_FILE;
  let keyFile: string;

  beforeEach(() => {
    keyFile = path.join(os.tmpdir(), `roon-openai-resolve-${process.pid}-${Date.now()}.json`);
    process.env.OPENAI_KEY_FILE = keyFile;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    fs.rmSync(keyFile, { force: true });
    if (originalEnv === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalEnv;
    }
    if (originalFile === undefined) {
      delete process.env.OPENAI_KEY_FILE;
    } else {
      process.env.OPENAI_KEY_FILE = originalFile;
    }
  });

  it("throws when stored and env keys are empty", () => {
    expect(() => resolveOpenAIApiKey()).toThrow("OpenAI API key is missing. Add yours in Settings.");
    try {
      resolveOpenAIApiKey();
    } catch (err) {
      expect(isMissingOpenAIKeyError(err)).toBe(true);
    }
  });

  it("falls back to OPENAI_API_KEY when none is stored", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveOpenAIApiKey()).toBe("env-key");
  });

  it("prefers the stored Settings key over env", () => {
    process.env.OPENAI_API_KEY = "env-key";
    fs.writeFileSync(keyFile, JSON.stringify({ apiKey: "sk-user" }), "utf8");
    expect(resolveOpenAIApiKey()).toBe("sk-user");
  });

  it("recognizeAlbumFromImage rethrows a missing key", async () => {
    await expect(recognizeAlbumFromImage("x", "image/png")).rejects.toThrow(
      "OpenAI API key is missing. Add yours in Settings."
    );
  });
});
