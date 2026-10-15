import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIVATION_DATABASE_MESSAGES } from "@/lib/activation-errors";

// Later migrations supersede earlier function definitions. Inspect only the
// final body, not the union of historical messages (which would hide drift).
describe("activation database error contract", () => {
  it("matches the latest migration-defined activate_investment messages", () => {
    const directory = join(process.cwd(), "supabase/migrations");
    let latest: { file: string; body: string } | undefined;
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(join(directory, file), "utf8");
      const definitions = sql.matchAll(
        /create\s+(?:or\s+replace\s+)?function\s+public\.activate_investment\s*\([\s\S]*?\bas\s+(\$[\w]*\$)([\s\S]*?)\1\s*;/gi,
      );
      for (const definition of definitions)
        latest = { file, body: definition[2] };
    }
    expect(latest, "No activate_investment definition found").toBeDefined();
    const messages = new Set(
      [...latest!.body.matchAll(/\bmessage\s*=\s*'((?:''|[^'])*)'/gi)].map(
        (match) => match[1].replaceAll("''", "'"),
      ),
    );
    expect(messages.size).toBeGreaterThan(0);
    expect(
      [...messages].sort(),
      `Update safe activation messages for ${latest!.file}`,
    ).toEqual([...ACTIVATION_DATABASE_MESSAGES].sort());
  });
});
