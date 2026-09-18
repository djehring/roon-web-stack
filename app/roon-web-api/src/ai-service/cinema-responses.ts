import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

interface ResponseContext {
  directory: string;
  progress: (message: string) => Promise<void>;
}
interface ResponseStatus {
  status?: string;
}
const contexts = new AsyncLocalStorage<ResponseContext>();

export function withCinemaResponses<T>(
  context: ResponseContext,
  work: () => Promise<T>
): Promise<T> {
  return contexts.run(context, work);
}

export function cinemaProgress(message: string): Promise<void> | undefined {
  return contexts.getStore()?.progress(message);
}

/** Keep completed web research on retry; the caller checkpoints validated JSON drafts. */
export async function cinemaResponse<T extends ResponseStatus>(
  body: Record<string, unknown>,
  apiKey: string,
  stage: string
): Promise<T> {
  const context = contexts.getStore();
  const payload = JSON.stringify(body);
  const hash = createHash("sha256").update(payload).digest("hex");
  const file =
    context &&
    Array.isArray(body.tools) &&
    path.join(context.directory, `${hash}.json`);
  if (file) {
    const saved = await readCompleted<T>(file);
    if (saved) return saved;
  }
  let value: T;
  for (let attempt = 0; ; attempt++) {
    await context?.progress(
      attempt ? `${stage} — retrying a slow connection…` : `${stage}…`
    );
    try {
      // Web research routinely runs longer than a short structured-output call.
      // Give it enough time on the first attempt to avoid paying for a restart.
      const timeout = attempt || Array.isArray(body.tools) ? 300_000 : 150_000;
      value = await request<T>(payload, apiKey, timeout);
      break;
    } catch (error) {
      if (attempt || !retryable(error)) throw describe(error, stage);
      await delay(1_000);
    }
  }
  if (file) await saveCompleted(file, value);
  return value;
}

async function readCompleted<T extends ResponseStatus>(
  file: string
): Promise<T | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as T;
    return value.status === "completed" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function saveCompleted(file: string, value: ResponseStatus) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value));
  await fs.rename(temporary, file);
}

class ServiceError extends Error {
  constructor(
    readonly status: number,
    detail: string
  ) {
    super(
      `Research service returned HTTP ${status}${detail ? `: ${detail}` : ""}`
    );
  }
}

async function request<T extends ResponseStatus>(
  payload: string,
  apiKey: string,
  timeout: number
): Promise<T> {
  const result = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: payload,
  });
  if (!result.ok) {
    const failure = (await result.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new ServiceError(
      result.status,
      failure.error?.message?.slice(0, 400) ?? ""
    );
  }
  const value = (await result.json()) as T;
  if (value.status !== "completed")
    throw new Error("Research did not complete.");
  return value;
}

function retryable(error: unknown): boolean {
  if (error instanceof ServiceError)
    return [408, 429, 500, 502, 503, 504].includes(error.status);
  return (
    ["TimeoutError", "AbortError"].includes(errorName(error)) ||
    (errorName(error) === "TypeError" && errorMessage(error) === "fetch failed")
  );
}

function describe(error: unknown, stage: string): Error {
  if (["TimeoutError", "AbortError"].includes(errorName(error))) {
    return new Error(
      `${stage} timed out after a retry. Retry picture update to continue from the saved research.`
    );
  }
  return error instanceof Error
    ? error
    : new Error(`${stage} failed. Please retry.`);
}

function errorName(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
    ? error.name
    : "";
}
function errorMessage(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "";
}
