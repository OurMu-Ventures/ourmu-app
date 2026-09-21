import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

// Next.js merges matching header rules in order with last-wins semantics for
// duplicate keys, so the test reproduces that merge for a given path.
async function resolveHeadersForPath(pathname: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const matches = (source: string) => {
    if (source === pathname) return true;
    if (source === "/(.*)") return true;
    return false;
  };
  const merged: Record<string, string> = {};
  for (const rule of rules.filter((rule) => matches(rule.source))) {
    for (const header of rule.headers) {
      merged[header.key] = header.value;
    }
  }
  return merged;
}

describe("auth/start response headers", () => {
  it("ends with Referrer-Policy: no-referrer despite the catch-all default", async () => {
    const headers = await resolveHeadersForPath("/auth/start");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("keeps the specific /auth/start rule last so it wins the merge", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const genericIndex = rules.findIndex((rule) => rule.source === "/(.*)");
    const startIndex = rules.findIndex((rule) => rule.source === "/auth/start");
    expect(genericIndex).toBeGreaterThanOrEqual(0);
    expect(startIndex).toBeGreaterThan(genericIndex);
  });

  it("leaves the catch-all default intact for other pages", async () => {
    const headers = await resolveHeadersForPath("/login");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cache-Control"]).toBeUndefined();
  });
});
