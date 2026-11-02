// Typed errors. Each carries a stable `code` so callers and the audit log can
// branch on it without string-matching messages. Messages never contain secrets
// or full document text.

export abstract class AutopilotError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A policy document that should exist is missing (e.g. no renewal PDF). */
export class DocumentMissingError extends AutopilotError {
  readonly code = 'document_missing';

  constructor(
    readonly policyId: string,
    readonly documentKind: 'expiring' | 'renewal',
    options?: { cause?: unknown },
  ) {
    super(`The ${documentKind} document for policy ${policyId} is missing`, options);
  }
}

/** A document exists but has no usable text (e.g. image-only scan). */
export class DocumentUnreadableError extends AutopilotError {
  readonly code = 'document_unreadable';

  constructor(
    readonly documentPath: string,
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`Document ${documentPath} is unreadable: ${reason}`, options);
  }
}

/** The LLM returned output that is not valid JSON or fails the schema after retries. */
export class LlmOutputInvalidError extends AutopilotError {
  readonly code = 'llm_output_invalid';

  constructor(
    readonly problems: string[],
    readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super(`LLM output invalid after ${attempts} attempt(s): ${problems.join('; ')}`, options);
  }
}

/** Configuration is missing or invalid. `problems` holds one readable line per issue. */
export class ConfigError extends AutopilotError {
  readonly code = 'config_invalid';

  constructor(
    readonly problems: string[],
    options?: { cause?: unknown },
  ) {
    super(
      `Configuration error: ${problems.length} problem(s) found\n${problems.map((p) => `  - ${p}`).join('\n')}`,
      options,
    );
  }
}

/** The data source could not be read or written. */
export class DataSourceError extends AutopilotError {
  readonly code = 'data_source_error';
}

/** An approval was attempted by someone who is not allowed, or in a state that forbids it. */
export class ApprovalNotAllowedError extends AutopilotError {
  readonly code = 'approval_not_allowed';
}

/** Addition (D-010): input failed a domain Zod schema. `problems` holds one line per issue. */
export class DomainValidationError extends AutopilotError {
  readonly code = 'domain_validation_failed';

  constructor(
    readonly label: string,
    readonly problems: string[],
    options?: { cause?: unknown },
  ) {
    super(`Invalid ${label}: ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}`).join('\n')}`, options);
  }
}

/**
 * A WARNING, not an error: a quoted source sentence was not found on its stated page.
 * The fact is kept with confidence lowered to 'low' and shown to the broker for checking.
 */
export class QuoteNotFoundWarning {
  readonly kind = 'quote_not_found' as const;

  constructor(
    readonly field: string,
    readonly sourcePage: number | null,
    readonly message: string = `Quote for "${field}" was not found on page ${sourcePage ?? 'unknown'}`,
  ) {}
}
