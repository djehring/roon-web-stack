import * as fs from "node:fs";
import * as path from "node:path";

interface OpenAIKeyFile {
  apiKey: string;
}

const openaiKeyFilePath = (): string => {
  if (process.env.OPENAI_KEY_FILE) {
    return process.env.OPENAI_KEY_FILE;
  }
  return path.join(process.cwd(), "config", "openai.json");
};

const isOpenAIKeyFile = (value: unknown): value is OpenAIKeyFile => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("apiKey" in value)) {
    return false;
  }
  return typeof value.apiKey === "string";
};

const readPersistedKey = (): string => {
  try {
    const raw = fs.readFileSync(openaiKeyFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isOpenAIKeyFile(parsed)) {
      return parsed.apiKey.trim();
    }
  } catch {
    return "";
  }
  return "";
};

const writePersistedKey = (apiKey: string): void => {
  const dir = path.dirname(openaiKeyFilePath());
  fs.mkdirSync(dir, { recursive: true });
  const payload: OpenAIKeyFile = { apiKey };
  fs.writeFileSync(openaiKeyFilePath(), JSON.stringify(payload), "utf8");
};

class InternalOpenAIKeyStore {
  read = (): string => {
    return readPersistedKey();
  };

  save = (apiKey: string): void => {
    const trimmed = apiKey.trim();
    if (trimmed === "") {
      fs.rmSync(openaiKeyFilePath(), { force: true });
      return;
    }
    writePersistedKey(trimmed);
  };
}

export const openaiKeyStore: InternalOpenAIKeyStore = new InternalOpenAIKeyStore();
