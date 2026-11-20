import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPOSIT_DATABASE_MESSAGES } from "@/lib/bank-deposits";

// Later migrations supersede earlier definitions; inspect only the final body.
describe("bank deposit database error contract", () => {
  it("matches the latest migration-defined allocate_bank_deposit messages", () => {
    const directory = join(process.cwd(), "supabase/migrations");
    let latest: { file: string; body: string } | undefined;
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(join(directory, file), "utf8");
      const definitions = sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.allocate_bank_deposit\s*\([\s\S]*?\bas\s+(\$[\w]*\$)([\s\S]*?)\1\s*;/gi,
      );
      for (const definition of definitions)
        latest = { file, body: definition[2] };
    }
    expect(latest, "No allocate_bank_deposit definition found").toBeDefined();
    const messages = new Set(
      [...latest!.body.matchAll(/\bmessage\s*=\s*'((?:''|[^'])*)'/gi)].map(
        (match) => match[1].replaceAll("''", "'"),
      ),
    );
    expect(
      [...messages].sort(),
      `Update safe deposit messages for ${latest!.file}`,
    ).toEqual([...DEPOSIT_DATABASE_MESSAGES].sort());
  });
});
