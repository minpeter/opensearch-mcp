import type { EngineFailureKind, SearchEngineName } from "./types.ts";

export class SearchExecutionError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SearchExecutionError";
    this.retryable = retryable;
  }
}

export class SearchEngineError extends Error {
  readonly engine: SearchEngineName;
  readonly kind: EngineFailureKind;

  constructor(
    engine: SearchEngineName,
    kind: EngineFailureKind,
    message: string
  ) {
    super(message);
    this.engine = engine;
    this.kind = kind;
    this.name = "SearchEngineError";
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function formatFailureSummary(failures: SearchEngineError[]): string {
  if (failures.length === 0) {
    return "";
  }

  const details = failures
    .map((failure) => `${failure.engine}:${failure.kind}`)
    .join("; ");

  return ` [${details}]`;
}
