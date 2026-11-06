vi.mock("@/lib/deposit-slips", () => ({
  cleanupDepositSlips: vi.fn(async () => ({ deleted: 0, failed: 0 })),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/crypto")>();
  return { ...actual, safeSecretEqual: vi.fn(actual.safeSecretEqual) };
});
import {
  authorizeCronRequest,
  bearerToken,
  configuredCronSecret,
  dispatchIdFrom,
  identifyTrigger,
} from "@/lib/cron-auth";
import { safeSecretEqual } from "@/lib/security/crypto";

const CRON = "cron-secret-for-unit-tests-".padEnd(40, "0");
const JOB = "job-trigger-secret-for-unit-tests-".padEnd(48, "0");
const DISPATCH_ID = "88000000-0000-4000-8000-000000000001";

function request(headers: Record<string, string> = {}) {
  return new Request("https://partners.example.test/api/cron/jobs", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.mocked(safeSecretEqual).mockClear();
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("JOB_TRIGGER_SECRET", JOB);
});
afterEach(() => vi.unstubAllEnvs());

describe("bearer parsing", () => {
  it.each([
    ["unset", undefined],
    ["set", JOB],
  ])(
    "rejects a missing or empty bearer before comparing (JOB_TRIGGER_SECRET %s)",
    (_label, jobSecret) => {
      vi.stubEnv("JOB_TRIGGER_SECRET", jobSecret);
      const missingOrEmpty: Array<Record<string, string>> = [
        {},
        { authorization: "Bearer " },
        { authorization: "Bearer" },
        { authorization: "Bearer \t " },
      ];
      for (const headers of missingOrEmpty) {
        expect(bearerToken(request(headers))).toBeNull();
        expect(
          authorizeCronRequest(request(headers), [
            "CRON_SECRET",
            "JOB_TRIGGER_SECRET",
          ]),
        ).toBeNull();
      }
      expect(safeSecretEqual).not.toHaveBeenCalled();
    },
  );

  it("never compares an empty string", () => {
    vi.stubEnv("JOB_TRIGGER_SECRET", "");
    for (const authorization of ["Bearer ", "Bearer x", `Bearer ${CRON}`])
      authorizeCronRequest(request({ authorization }), [
        "CRON_SECRET",
        "JOB_TRIGGER_SECRET",
      ]);
    for (const [left, right] of vi.mocked(safeSecretEqual).mock.calls) {
      expect(left).not.toBe("");
      expect(right).not.toBe("");
    }
  });

  it("rejects a raw secret without the Bearer scheme", () => {
    expect(
      authorizeCronRequest(request({ authorization: CRON }), ["CRON_SECRET"]),
    ).toBeNull();
    expect(bearerToken(request({ authorization: `Basic ${CRON}` }))).toBeNull();
    expect(
      bearerToken(request({ authorization: `Bearer ${CRON} extra` })),
    ).toBeNull();
  });

  it("accepts a lowercase bearer scheme", () => {
    expect(
      authorizeCronRequest(request({ authorization: `bearer ${CRON}` }), [
        "CRON_SECRET",
      ]),
    ).toBe("cron_secret");
  });

  it("rejects tokens over 512 characters", () => {
    expect(
      bearerToken(request({ authorization: `Bearer ${"t".repeat(512)}` })),
    ).toBe("t".repeat(512));
    expect(
      bearerToken(request({ authorization: `Bearer ${"t".repeat(513)}` })),
    ).toBeNull();
    vi.stubEnv("JOB_TRIGGER_SECRET", "t".repeat(513));
    expect(configuredCronSecret("JOB_TRIGGER_SECRET")).toBeNull();
    expect(
      authorizeCronRequest(
        request({ authorization: `Bearer ${"t".repeat(513)}` }),
        ["JOB_TRIGGER_SECRET"],
      ),
    ).toBeNull();
    expect(safeSecretEqual).not.toHaveBeenCalled();
  });
});

describe("secret selection", () => {
  it("identifies a valid CRON_SECRET", () => {
    expect(
      authorizeCronRequest(request({ authorization: `Bearer ${CRON}` }), [
        "CRON_SECRET",
        "JOB_TRIGGER_SECRET",
      ]),
    ).toBe("cron_secret");
  });

  it("accepts JOB_TRIGGER_SECRET only where the route accepts it", () => {
    const dispatcher = { authorization: `Bearer ${JOB}` };
    expect(
      authorizeCronRequest(request(dispatcher), [
        "CRON_SECRET",
        "JOB_TRIGGER_SECRET",
      ]),
    ).toBe("job_trigger_secret");
    // The maintenance route accepts CRON_SECRET only.
    expect(
      authorizeCronRequest(request(dispatcher), ["CRON_SECRET"]),
    ).toBeNull();
  });

  it("ignores a 31-character JOB_TRIGGER_SECRET without throwing", () => {
    const short = "s".repeat(31);
    vi.stubEnv("JOB_TRIGGER_SECRET", short);
    expect(configuredCronSecret("JOB_TRIGGER_SECRET")).toBeNull();
    expect(
      authorizeCronRequest(request({ authorization: `Bearer ${short}` }), [
        "CRON_SECRET",
        "JOB_TRIGGER_SECRET",
      ]),
    ).toBeNull();
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])(
    "keeps CRON_SECRET working with JOB_TRIGGER_SECRET %s",
    (_label, value) => {
      vi.stubEnv("JOB_TRIGGER_SECRET", value);
      expect(() => configuredCronSecret("JOB_TRIGGER_SECRET")).not.toThrow();
      expect(configuredCronSecret("JOB_TRIGGER_SECRET")).toBeNull();
      expect(
        authorizeCronRequest(request({ authorization: `Bearer ${CRON}` }), [
          "CRON_SECRET",
          "JOB_TRIGGER_SECRET",
        ]),
      ).toBe("cron_secret");
    },
  );

  it("never accepts a short CRON_SECRET", () => {
    const short = "c".repeat(31);
    vi.stubEnv("CRON_SECRET", short);
    expect(
      authorizeCronRequest(request({ authorization: `Bearer ${short}` }), [
        "CRON_SECRET",
      ]),
    ).toBeNull();
    expect(safeSecretEqual).not.toHaveBeenCalled();
  });
});

describe("trigger identification", () => {
  it("treats the dispatcher secret as pg_cron whatever the headers say", () => {
    expect(
      identifyTrigger(
        request({
          "user-agent": "vercel-cron/1.0",
          "x-ourmu-trigger": "github",
        }),
        "job_trigger_secret",
      ),
    ).toBe("pg_cron");
  });

  it("reads the Vercel Cron user agent and the declared trigger", () => {
    expect(
      identifyTrigger(
        request({ "user-agent": "vercel-cron/1.0" }),
        "cron_secret",
      ),
    ).toBe("vercel_cron");
    expect(
      identifyTrigger(
        request({ "x-ourmu-trigger": " GitHub " }),
        "cron_secret",
      ),
    ).toBe("github");
    expect(
      identifyTrigger(request({ "x-ourmu-trigger": "manual" }), "cron_secret"),
    ).toBe("manual");
  });

  it("never lets a CRON_SECRET caller claim pg_cron", () => {
    expect(
      identifyTrigger(request({ "x-ourmu-trigger": "pg_cron" }), "cron_secret"),
    ).toBe("unknown");
    expect(
      identifyTrigger(request({ "x-ourmu-trigger": "cron" }), "cron_secret"),
    ).toBe("unknown");
    expect(identifyTrigger(request(), "cron_secret")).toBe("unknown");
  });

  it("reads a dispatch id only from pg_cron calls", () => {
    const headers = { "x-ourmu-dispatch-id": DISPATCH_ID };
    expect(dispatchIdFrom(request(headers), "pg_cron")).toBe(DISPATCH_ID);
    expect(dispatchIdFrom(request(headers), "github")).toBeNull();
    expect(
      dispatchIdFrom(
        request({ "x-ourmu-dispatch-id": "not-a-uuid" }),
        "pg_cron",
      ),
    ).toBeNull();
    expect(dispatchIdFrom(request(), "pg_cron")).toBeNull();
  });
});
