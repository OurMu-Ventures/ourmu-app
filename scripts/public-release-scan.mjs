import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [
  /(^|\/)\.env(?!\.example$)/,
  /(^|\/)\.vercel\//,
  /^backend\//,
  /^supabase\/\.temp\//,
  /^docs\/legal\/APPROVAL_REQUIRED\.md$/,
  /^\.github\/workflows\/(backup|maintenance|release-gate|restore-test)\.yml$/,
  /\.(csv|tsv|xls|xlsx|dump|backup|age|key|p12|pfx|jks|keystore|tfvars)$/i,
  /\.sql\.gz$/i,
  /\.manifest\.json$/i,
];

// Hashes let CI block known private identifiers without republishing the values.
// Maintainers keep the corresponding plaintext denylist in protected Supabase
// Storage, never in Git.
const forbiddenTokenHashes = new Set([
  "fd3923f86ce1ab444d44f1ef91ba213c8c63be5df47f8f4b0aeefc81ec1fb831",
  "fcc0501e288a1c0c273cc2c083cd1ddfb76b5fad1bd93e68997b7b788684dd06",
  "c8e2fe7740115c69fdfe20e8c0b1cd5835767b9eecd789da84e65d761ee8528c",
  "03458201bca294b9daf9c8f9a400c5ea5d2bcce82aecd2e4980a79279f743626",
  "6e4ae468344bcb2e7d4d2be7dec7634d701a62640129c3c7c20f00da48510256",
  "9b393fb3df749c1fdf7d75759cb33338a92f33c04b5c5fdd844a574e4e6277f6",
  "bb8a14213f3cafbb252db39b9d8221e52f1761b5914b6288812c0de2ad9f8011",
  "0b490502810fc48b374d5db74b47d73a5496410afd2d4df589f0a39196de2b24",
  "7e29e8ce5700948f5328179e202f33a1a1b36994774a60e76d7061eec40336ff",
  "6d8cd2ea7db0352bc97f8f12de40edfad86e6768eb7e48bad486b8fd0b051629",
  "bd5762241d1c5462a1e07b49ddc0718342b37586aebed63c604e73d46d297044",
]);

const findings = [];
for (const file of tracked) {
  if (!existsSync(file)) continue;
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    findings.push(`${file}: forbidden tracked path`);
    continue;
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const content = bytes.toString("utf8");
  for (const token of content.match(/[A-Za-z0-9@._-]{8,}/g) ?? []) {
    const digest = createHash("sha256").update(token).digest("hex");
    if (forbiddenTokenHashes.has(digest)) {
      findings.push(`${file}: known private identifier or production value`);
    }
  }
}

if (findings.length) {
  console.error("Public-release scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Public-release scan passed (${tracked.length} tracked files).`);
