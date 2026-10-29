export type RunStatus = 'ok' | 'retry' | 'fail';

/** A validated log event. Timestamp text, including its offset, stays unchanged. */
export interface RunEvent {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
}

/** Aggregated in file order; first/last refer to valid event occurrences. */
export interface DigestRow {
  job: string;
  /** Owner on the last event, including an explicit null. */
  owner: string | null;
  /** All valid events for this job, including retries and failures. */
  runs: number;
  /** Number of events whose status is retry. */
  retries: number;
  /** Number of fail events; a later ok must not hide an earlier failure. */
  failures: number;
  lastStatus: RunStatus;
  /** Most recent supplied error, or null if no event supplied an error. */
  lastError: string | null;
  /** Original timestamp strings from the first and last events. */
  firstAt: string;
  lastAt: string;
}

/** Event totals, not counts of jobs' final statuses. */
export interface StatusCounts {
  ok: number;
  retry: number;
  fail: number;
}

export interface NightSummary {
  night: string;
  counts: StatusCounts;
  /** Invalid JSON/event records, including blank or whitespace-only lines. */
  badLines: number;
}

export interface NightDigest extends NightSummary {
  /** One row per job, ascending by JS string comparison (not locale-dependent). */
  rows: DigestRow[];
}

/** null means no file or invalid night; an empty file has zero rows/counts/badLines. */
export type ReadNightResult = NightDigest | null;

/**
 * Read runsDir/<night>.jsonl synchronously. Invalid records (including blank
 * lines) increase badLines and never abort the night. A final newline terminates
 * its record, without creating another one. Other I/O errors propagate.
 * Night values outside valid calendar dates in YYYY-MM-DD return null before I/O.
 * Consumers share this result for HTML, JSON, and board summaries.
 */
export type ReadNight = (runsDir: string, night: string) => ReadNightResult;
