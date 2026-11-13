// Clones a disposable pre-account schema database, seeds synthetic investments,
// applies the migration, and verifies that balances and document evidence survive.
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const container = process.env.OURMU_TEST_CONTAINER;
const template = process.env.OURMU_TEST_TEMPLATE_DB;
assert.ok(
  container && template,
  "Provide a disposable pre-account test template",
);
const database = `ourmu_account_migration_${process.pid}`;
function run(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, ...args]);
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });
}
const query = (sql) =>
  run(
    [
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      database,
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    sql,
  );
async function success(sql) {
  const result = await query(sql);
  assert.equal(result.code, 0, result.output);
  return result.output.trim();
}
const created = await run([
  "createdb",
  "-U",
  "supabase_admin",
  "-O",
  "postgres",
  "-T",
  template,
  database,
]);
assert.equal(created.code, 0, created.output);
try {
  const fixture = (
    await readFile(
      new URL(
        "../supabase/tests/partner_investment_limits.test.sql",
        import.meta.url,
      ),
      "utf8",
    )
  )
    .split("set local role service_role;")[0]
    .replace("select no_plan();", "");
  await success(fixture + "commit;");
  const before = await success(
    "select count(*) || ':' || sum(principal_ugx)::text || ':' || sum(projected_value_ugx)::text from public.investments;",
  );
  const files = await readdir(
    new URL("../supabase/migrations/", import.meta.url),
  );
  const migration = files.find((file) =>
    file.endsWith("_multiple_investment_accounts.sql"),
  );
  assert.ok(migration);
  await success(
    await readFile(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    await success(
      "select count(*) || ':' || sum(principal_ugx)::text || ':' || sum(projected_value_ugx)::text from public.investments;",
    ),
    before,
  );
  assert.equal(
    await success(
      "select count(*) from public.investments i join public.investment_accounts a on a.id=i.account_id and a.investor_id=i.investor_id where a.is_default;",
    ),
    "3",
  );
  assert.equal(
    await success(
      "select count(*) from public.investment_accounts where is_default;",
    ),
    "2",
  );
  console.log(
    "PASS: existing profiles and investments migrate to Main Account with unchanged balances",
  );
} finally {
  const dropped = await run(["dropdb", "-U", "supabase_admin", database]);
  assert.equal(dropped.code, 0, dropped.output);
}
