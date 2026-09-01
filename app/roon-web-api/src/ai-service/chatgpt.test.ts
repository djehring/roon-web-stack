import { isMissingOpenAIKeyError, recognizeAlbumFromImage, resolveOpenAIApiKey, runWithOpenAIKey } from "./chatgpt";

describe("chatgpt OpenAI key resolution", () => {
  const original = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it("throws when env and request key are empty", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => resolveOpenAIApiKey()).toThrow("OpenAI API key is missing. Add yours in Settings.");
    try {
      resolveOpenAIApiKey();
    } catch (err) {
      expect(isMissingOpenAIKeyError(err)).toBe(true);
    }
  });

  it("falls back to OPENAI_API_KEY when the request has none", () => {
    process.env.OPENAI_API_KEY = "env-key";
    expect(resolveOpenAIApiKey()).toBe("env-key");
  });

  it("prefers the request key over env", () => {
    process.env.OPENAI_API_KEY = "env-key";
    const resolved = runWithOpenAIKey("sk-user", () => resolveOpenAIApiKey());
    expect(resolved).toBe("sk-user");
  });

  it("recognizeAlbumFromImage rethrows a missing key", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(recognizeAlbumFromImage("x", "image/png")).rejects.toThrow(
      "OpenAI API key is missing. Add yours in Settings."
    );
  });
});
