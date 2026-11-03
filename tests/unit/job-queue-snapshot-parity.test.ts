import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { EMAIL_DEFERRAL_CODES } from "@/lib/email/quota";
import { DELIBERATE_DROP_CODES } from "@/lib/jobs";

const migrations = path.resolve(
  import.meta.dirname,
  "../../supabase/migrations",
);

// The latest migration that (re)defines the function, from its definition on.
function latestDefinition(signature: string): string {
  const sources = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(migrations, file), "utf8"))
    .filter((sql) => sql.includes(signature));
  const sql = sources.at(-1) ?? "";
  expect(sql, `no migration defines ${signature}`).not.toBe("");
  return sql.slice(sql.indexOf(signature));
}

// The quoted values of the first array[...] after the marker comment.
function markedArray(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  expect(start, `${marker} is missing`).toBeGreaterThan(-1);
  const array = /array\s*\[([^\]]*)\]/i.exec(sql.slice(start + marker.length));
  expect(array, `no array follows ${marker}`).not.toBeNull();
  return [...(array?.[1] ?? "").matchAll(/'([^']*)'/g)].map(
    (match) => match[1],
  );
}

describe("SQL and TypeScript code lists", () => {
  it("job_queue_snapshot holds email for exactly EMAIL_DEFERRAL_CODES", () => {
    const codes = markedArray(
      latestDefinition("function public.job_queue_snapshot"),
      "/* EMAIL_DEFERRAL_CODES */",
    );
    expect(new Set(codes)).toEqual(new Set(EMAIL_DEFERRAL_CODES));
  });

  it("job_dispatch_health leaves out exactly DELIBERATE_DROP_CODES", () => {
    const codes = markedArray(
      latestDefinition("function public.job_dispatch_health"),
      "/* DELIBERATE_DROP_CODES */",
    );
    expect(new Set(codes)).toEqual(new Set(DELIBERATE_DROP_CODES));
  });
});
