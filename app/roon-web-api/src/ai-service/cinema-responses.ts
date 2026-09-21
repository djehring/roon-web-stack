import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface ResponseContext {
  directory: string;
  progress: (message: string) => Promise<void>;
}
interface ResponseStatus {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string };
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  output?: { type: string; action?: { type?: string }; content?: { type: string; text?: string }[] }[];
}
interface ResponseRun extends ResponseContext {
  deadline: number;
  accounting: Promise<void>;
}
interface UsageEntry {
  id: string;
  stage: string;
  model: unknown;
  startedAt: string;
  outputAllowance: number;
  toolAllowance: number;
  status: string;
  responseId?: string;
  usage?: ResponseStatus["usage"];
  webSearchCalls?: number;
  finishedAt?: string;
}
// These are usage limits, not a currency estimate. Reservations survive failed
// attempts and bridge restarts, including requests whose usage is unknown.
export const cinemaLimits = { calls: 24, outputTokens: 80_000, toolCalls: 32, durationMs: 600_000 };
const contexts = new AsyncLocalStorage<ResponseRun>();

export function withCinemaResponses<T>(context: ResponseContext, work: () => Promise<T>): Promise<T> {
  let progress = Promise.resolve();
  return contexts.run(
    {
      ...context,
      deadline: Date.now() + cinemaLimits.durationMs,
      accounting: Promise.resolve(),
      progress: (message) => {
        checkDeadline();
        progress = progress.then(() => context.progress(message));
        return progress;
      },
    },
    work
  );
}

export function cinemaProgress(message: string): Promise<void> | undefined {
  return contexts.getStore()?.progress(message);
}

/** Reuse completed work; never resubmit a possibly billable request automatically. */
export async function cinemaResponse<T extends ResponseStatus>(
  body: Record<string, unknown>,
  apiKey: string,
  stage: string
): Promise<T> {
  const context = contexts.getStore();
  checkDeadline();
  if (typeof body.input === "string" && body.input.length > 120_000)
    throw new Error("Cinema's research input is too large. Choose fewer topics before continuing.");
  body = {
    ...body,
    max_output_tokens: Math.min(typeof body.max_output_tokens === "number" ? body.max_output_tokens : 4096, 6144),
    ...(Array.isArray(body.tools)
      ? { max_tool_calls: Math.min(typeof body.max_tool_calls === "number" ? body.max_tool_calls : 4, 4) }
      : {}),
  };
  const payload = JSON.stringify(body);
  const hash = createHash("sha256").update(payload).digest("hex");
  const file = context && path.join(context.directory, `${hash}.json`);
  if (file) {
    const saved = await readCompleted<T>(file);
    if (saved) return saved;
  }
  await context?.progress(`${stage}…`);
  const entry = await reserveUsage(body, stage);
  let value: T;
  try {
    const timeout = Math.min(Array.isArray(body.tools) ? 180_000 : 120_000, checkDeadline());
    value = await request<T>(payload, apiKey, timeout);
    await recordUsage(entry, value);
    if (value.status !== "completed")
      throw new Error(
        `${stage} did not complete (${value.incomplete_details?.reason ?? value.status ?? "unknown"}). No automatic retry was made.`
      );
  } catch (error) {
    if (entry?.status === "submitted") await recordUsage(entry, undefined);
    throw describe(error, stage);
  }
  // Malformed JSON must not become a permanently replayed invalid checkpoint.
  if (file && cacheable(body, value)) await saveCompleted(file, value);
  return value;
}

function checkDeadline(): number {
  const remaining = (contexts.getStore()?.deadline ?? Infinity) - Date.now();
  if (remaining <= 0)
    throw new Error(
      "Cinema reached its 10-minute preparation limit. Completed work is saved; no further AI calls will be started."
    );
  return remaining;
}

function cacheable(body: Record<string, unknown>, value: ResponseStatus): boolean {
  if (Array.isArray(body.tools)) return true;
  try {
    JSON.parse(
      (value.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === "output_text")
        .map((part) => part.text ?? "")
        .join("\n")
    );
    return true;
  } catch {
    return false;
  }
}

async function account<T>(work: (entries: UsageEntry[]) => T): Promise<T | undefined> {
  const context = contexts.getStore();
  if (!context) return undefined;
  const file = path.join(context.directory, "usage.json");
  const operation = context.accounting.then(async () => {
    const entries = await fs
      .readFile(file, "utf8")
      .then((data) => JSON.parse(data) as UsageEntry[])
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
    const result = work(entries);
    await saveCompleted(file, entries);
    return result;
  });
  context.accounting = operation.then(
    () => undefined,
    () => undefined
  );
  return operation;
}

async function reserveUsage(body: Record<string, unknown>, stage: string): Promise<UsageEntry | undefined> {
  return account((entries) => {
    checkDeadline();
    const outputAllowance = typeof body.max_output_tokens === "number" ? body.max_output_tokens : 10_000;
    const toolAllowance = Array.isArray(body.tools)
      ? typeof body.max_tool_calls === "number"
        ? body.max_tool_calls
        : 8
      : 0;
    if (
      entries.length >= cinemaLimits.calls ||
      entries.reduce((sum, entry) => sum + entry.outputAllowance, 0) + outputAllowance > cinemaLimits.outputTokens ||
      entries.reduce((sum, entry) => sum + entry.toolAllowance, 0) + toolAllowance > cinemaLimits.toolCalls
    ) {
      throw new Error(
        "Cinema reached its AI usage limit for this montage. Completed work is saved. Choose fewer topics; repeating Retry will not reset the limit."
      );
    }
    const entry: UsageEntry = {
      id: randomUUID(),
      stage,
      model: body.model,
      startedAt: new Date().toISOString(),
      outputAllowance,
      toolAllowance,
      status: "submitted",
    };
    entries.push(entry);
    return entry;
  });
}

async function recordUsage(entry: UsageEntry | undefined, response: ResponseStatus | undefined) {
  if (!entry) return;
  await account((entries) => {
    const saved = entries.find((item) => item.id === entry.id);
    if (!saved) throw new Error("Cinema usage reservation is missing.");
    Object.assign(saved, {
      status: response?.status ?? "usage-unknown",
      responseId: response?.id,
      model: response?.model ?? entry.model,
      usage: response?.usage,
      webSearchCalls: response?.output?.filter(
        (item) => item.type === "web_search_call" && item.action?.type === "search"
      ).length,
      finishedAt: new Date().toISOString(),
    });
    entry.status = saved.status;
  });
}

async function readCompleted<T extends ResponseStatus>(file: string): Promise<T | undefined> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as T;
    return value.status === "completed" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function saveCompleted(file: string, value: unknown) {
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
    super(`Research service returned HTTP ${status}${detail ? `: ${detail}` : ""}`);
  }
}

async function request<T extends ResponseStatus>(payload: string, apiKey: string, timeout: number): Promise<T> {
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
    throw new ServiceError(result.status, failure.error?.message?.slice(0, 400) ?? "");
  }
  return (await result.json()) as T;
}

function describe(error: unknown, stage: string): Error {
  if (["TimeoutError", "AbortError"].includes(errorName(error))) {
    return new Error(
      `${stage} timed out. No automatic retry was made because the request may already have incurred charges. Completed work is saved.`
    );
  }
  return error instanceof Error ? error : new Error(`${stage} failed. Please retry.`);
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string" ? error.name : "";
}
