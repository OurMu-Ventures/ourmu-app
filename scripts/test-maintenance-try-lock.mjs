// Local-only: two sessions race for the maintenance try-lock (87005/2). Both
// roll back, so maintenance writes nothing.
import { spawn } from "node:child_process";
const args = [
  "exec",
  "-i",
  "supabase_db_ourmu-app",
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
];
function session(text) {
  return new Promise((resolve) => {
    const child = spawn("docker", args);
    let output = "";
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(text);
  });
}
const holder = session(
  "begin; select public.run_maintenance_exclusive(gen_random_uuid()); select pg_sleep(3); rollback;",
);
await new Promise((resolve) => setTimeout(resolve, 500));
const duplicate = session(
  "begin; select public.run_maintenance_exclusive(gen_random_uuid()); rollback;",
);
const results = await Promise.all([holder, duplicate]);
if (
  results.some((r) => r.code !== 0) ||
  !results[0].output.includes('"matured"') ||
  !results[1].output.includes('{"skipped": "concurrent"}')
)
  throw new Error(JSON.stringify(results));
console.log(
  "PASS: a second maintenance call skips while the first holds the try-lock.",
);
