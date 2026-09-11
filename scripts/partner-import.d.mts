export type ImportSummary = {
  partners: number;
  profiles: number;
  unclaimed: number;
  cycles: number;
  investments: number;
  summaries: number;
  matured: number;
  active: number;
  rate35: number;
  principal: string;
  returns: string;
  payout: string;
};

export type ImportManifest = {
  batch_id: string;
  source_filename: string;
  source_sha256: string;
  profiles: Array<Record<string, unknown>>;
  partners: Array<Record<string, unknown>>;
  cycles: Array<Record<string, unknown>>;
  investments: Array<Record<string, unknown>>;
  monthly_summaries: Array<Record<string, unknown>>;
  summary: ImportSummary;
};

export function normalizeName(value: unknown): string;
export function normalizeEmail(value: unknown): string | null;
export function normalizePhone(value: unknown): string | null;
export function deterministicUuid(namespace: string): string;
export function buildManifest(sourcePath: string): Promise<ImportManifest>;
