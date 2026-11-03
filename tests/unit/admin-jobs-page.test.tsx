// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_DEFERRAL_CODES } from "@/lib/email/quota";
import { dateTime } from "@/lib/format";

const state = vi.hoisted(() => ({
  jobs: [] as Array<Record<string, unknown>>,
  health: null as unknown,
  healthError: false,
  runs: [] as Array<Record<string, unknown>>,
  runsError: false,
  rpcCalls: [] as Array<[string, unknown]>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/actions/admin", () => ({
  reconcileJobDelivery: vi.fn(),
  retryJob: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/components/SubmitButton", () => ({
  SubmitButton: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));
vi.mock("@/components/ResolveMaturityCcReviewForm", () => ({
  ResolveMaturityCcReviewForm: () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let flagged = false;
      const query = {
        select: () => query,
        order: () => query,
        limit: () => query,
        eq: (field: string) => {
          flagged = field === "cc_review_required";
          return query;
        },
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data: flagged ? [] : state.jobs,
            error: null,
          }).then(resolve),
      };
      return query;
    },
    rpc: async (name: string, args: unknown) => {
      state.rpcCalls.push([name, args]);
      if (name === "job_dispatch_health")
        return state.healthError
          ? { data: null, error: { message: "unavailable" } }
          : { data: state.health, error: null };
      return state.runsError
        ? { data: null, error: { message: "unavailable" } }
        : { data: state.runs, error: null };
    },
  }),
}));
import JobsPage from "@/app/(admin)/admin/(console)/jobs/page";

const UNTIL = "2026-11-03T07:00:00+00:00";

function health(
  overrides: {
    status?: string;
    problems?: Array<{ code: string; detail: string }>;
    warnings?: Array<{ code: string; detail: string }>;
    emailHold?: { code: string; until: string; heldCount: number } | null;
    jobs?: Record<string, unknown>;
    pgNet?: Record<string, unknown>;
  } = {},
) {
  return {
    generatedAt: "2026-11-03T04:17:00.123456+00:00",
    status: overrides.status ?? "ok",
    problems: overrides.problems ?? [],
    warnings: overrides.warnings ?? [],
    thresholds: {
      tickStaleSec: 600,
      processableDueAgeSec: 900,
      expiredLeaseAgeSec: 900,
      consecutiveFailures: 3,
      pgNetOutstandingSec: 300,
      maintenanceAgeSec: 115200,
      deadWindowHours: 24,
    },
    dispatcher: {
      configured: true,
      cronInstalled: true,
      scheduled: true,
      cronLastRunStatus: "succeeded",
      cronLastRunAgeSec: 40,
      lastTickAt: "2026-11-03T04:16:20.000000+00:00",
      lastTickAgeSec: 40,
      lastReason: "idle",
      lastDispatchAt: "2026-11-03T04:02:00.000000+00:00",
      lastDispatchAgeSec: 900,
      lastOutcome: "ok",
      lastHttpStatus: 200,
      lastSuccessAt: "2026-11-03T04:02:20.000000+00:00",
      consecutiveFailures: 0,
      noProgressStreak: 0,
      noProgressUntil: null,
      lastError: null,
    },
    pgNet: {
      installed: true,
      workerRunning: true,
      queueDepth: 0,
      outstandingRequestId: null,
      outstandingQueued: false,
      outstandingAgeSec: null,
      ...overrides.pgNet,
    },
    queue: {
      dueCount: 0,
      processableDueCount: 0,
      oldestDueAgeSec: null,
      oldestProcessableDueAgeSec: null,
      expiredLeaseCount: 0,
      oldestExpiredLeaseAgeSec: null,
      emailHold: overrides.emailHold ?? null,
    },
    jobs: {
      dead24h: 0,
      dead24hByCode: {},
      dropped24h: 0,
      deadWindowSince: "2026-11-02T04:17:00.123456+00:00",
      deadInWindow: 0,
      openReconciliation: 0,
      ...overrides.jobs,
    },
    workerRuns: {
      since: "2026-11-02T04:17:00.123456+00:00",
      runs: 0,
      notOk: 0,
      failed: 0,
      stateErrors: 0,
      needsReconciliation: 0,
      unclaimable: 0,
      lastRunAt: null,
      lastRunTrigger: null,
    },
    maintenance: {
      lastCompletedAt: "2026-11-03T04:00:12.000000+00:00",
      ageSec: 1008,
    },
  };
}

function job(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-11-03T03:00:00+00:00",
    kind: "send_email",
    entity_type: "investment",
    entity_id: "88000000-0000-4000-8000-000000000000",
    status: "pending",
    attempts: 0,
    max_attempts: 8,
    last_error_code: null,
    available_at: "2026-11-03T03:00:00+00:00",
    cc_review_required: false,
    provider_message_id: null,
    ...overrides,
  };
}

function run(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    route: "jobs",
    trigger: "pg_cron",
    started_at: "2026-11-03T04:10:00+00:00",
    finished_at: "2026-11-03T04:10:07+00:00",
    ok: true,
    error_code: null,
    stop_reason: "queue_empty",
    maintenance_status: null,
    claimed: 2,
    succeeded: 2,
    failed: 0,
    deferred: 0,
    skipped: 0,
    unclaimable: 0,
    provider_accepted: 2,
    documents_generated: 0,
    recovered_leases: 0,
    needs_reconciliation: 0,
    state_errors: 0,
    processable_due_before: 2,
    oldest_due_age_sec_before: 30,
    remaining_due: 0,
    email_hold_code: null,
    email_hold_until: null,
    ...overrides,
  };
}

async function renderPage() {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(await JobsPage());
  return page;
}

function text(element: Element | null | undefined) {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? null;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T04:17:00Z"));
  state.jobs = [job("88000000-0000-4000-8000-000000000001")];
  state.health = health();
  state.healthError = false;
  state.runs = [run(1)];
  state.runsError = false;
  state.rpcCalls = [];
  return () => vi.useRealTimers();
});

describe("admin jobs page", () => {
  it("loads health for the last 24 hours and the last 20 runs", async () => {
    await renderPage();
    expect(state.rpcCalls).toEqual([
      ["job_dispatch_health", { p_since_last_watchdog: false }],
      ["job_worker_recent_runs", { p_limit: 20 }],
    ]);
  });

  it.each([
    [
      "EMAIL_DAILY_QUOTA_EXCEEDED",
      `Email sending is paused: Resend's daily quota was reached. The next check is at ${dateTime(UNTIL)}; checks repeat at least every 3 hours and at 00:01 UTC (03:01 Kampala).`,
    ],
    [
      "EMAIL_MONTHLY_QUOTA_EXCEEDED",
      `Email sending is paused: Resend's monthly quota was reached. The next check is at ${dateTime(UNTIL)} and repeats daily.`,
    ],
    [
      "EMAIL_RATE_LIMITED",
      `Email sending is paused by Resend's rate limit until ${dateTime(UNTIL)}.`,
    ],
    [
      "EMAIL_BUDGET_DEFERRED",
      `Email sending is paused by the portal's own budget (80 a day and 2,400 per 31 days, which keeps room for sign-in links) until ${dateTime(UNTIL)}.`,
    ],
  ])("explains a %s hold in one banner", async (code, sentence) => {
    state.health = health({
      status: "warn",
      emailHold: { code, until: UNTIL, heldCount: 3 },
    });
    const page = await renderPage();
    const banners = page.querySelectorAll('[role="status"]');
    expect(banners).toHaveLength(1);
    expect(text(banners[0])).toBe(
      `${sentence} 3 emails are waiting and use no retry attempts. PDF jobs continue. To check sooner, Retry every deferred email: while any one is still deferred, all email stays paused.`,
    );
  });

  it("covers every deferral code with its own hold sentence", async () => {
    for (const code of EMAIL_DEFERRAL_CODES) {
      state.health = health({
        emailHold: { code, until: UNTIL, heldCount: 1 },
      });
      const banner = text(
        (await renderPage()).querySelector('[role="status"]'),
      );
      expect(banner).not.toContain(`(${code})`);
      expect(banner).toContain(
        "1 email is waiting and uses no retry attempts.",
      );
    }
  });

  it("alerts on dead jobs and open reconciliation, not on deliberate drops", async () => {
    state.health = health({ jobs: { dropped24h: 4 } });
    let page = await renderPage();
    expect(page.querySelectorAll('[role="alert"]')).toHaveLength(0);
    state.health = health({
      status: "fail",
      jobs: { dead24h: 3, openReconciliation: 2, dropped24h: 4 },
    });
    page = await renderPage();
    expect(text(page.querySelector('[role="alert"]'))).toBe(
      "3 jobs failed permanently in the last 24 hours. Review them below; Retry gives one more attempt. 2 email deliveries need reconciliation. Check Resend before choosing Confirm delivered or Authorize resend.",
    );
    expect(
      text(page.querySelector('[aria-labelledby="worker-trigger"]')),
    ).toContain("Deliberately dropped emails (24 h)4Shown, never alerted.");
  });

  it("lists health problems and warnings in the worker trigger panel", async () => {
    state.health = health({
      status: "fail",
      problems: [
        { code: "QUEUE_STUCK", detail: "processable work due for 1200 s" },
        {
          code: "DISPATCH_FAILING",
          detail:
            "3 consecutive failed dispatches, last outcome http_error, HTTP 401",
        },
      ],
      warnings: [
        { code: "UNCLAIMABLE_JOBS", detail: "2 claims matched no row" },
      ],
    });
    const panel = (await renderPage()).querySelector(
      '[aria-labelledby="worker-trigger"]',
    );
    expect(text(panel?.querySelector("h2"))).toBe("Worker trigger");
    expect(text(panel)).toContain("Status: fail");
    expect([...(panel?.querySelectorAll("li") ?? [])].map(text)).toEqual([
      "Problem QUEUE_STUCK: processable work due for 1200 s",
      "Problem DISPATCH_FAILING: 3 consecutive failed dispatches, last outcome http_error, HTTP 401",
      "Warning UNCLAIMABLE_JOBS: 2 claims matched no row",
    ]);
    expect(text(panel)).toContain("Configured · scheduled");
    expect(text(panel)).toContain("Last tick: 40 s ago (idle)");
    expect(text(panel)).toContain(
      `Last dispatch: ${dateTime("2026-11-03T04:02:00+00:00")}, ok, HTTP 200`,
    );
    expect(text(panel)).toContain("Worker running · queue depth 0");
    expect(text(panel)).toContain(
      `Last maintenance${dateTime("2026-11-03T04:00:12+00:00")}`,
    );
  });

  it("shows the UTC times in health details in Kampala time", async () => {
    state.health = health({
      status: "fail",
      problems: [
        {
          code: "JOBS_DEAD",
          detail: "2 jobs became dead since 2026-11-03T04:17:00Z",
        },
        {
          code: "DISPATCHER_ERROR",
          detail: "error P0001: bad value 2026-13-45T99:99:99Z",
        },
      ],
      warnings: [
        {
          code: "EMAIL_HOLD",
          detail:
            "EMAIL_DAILY_QUOTA_EXCEEDED until 2026-11-04T00:01:00Z (3 emails waiting)",
        },
      ],
    });
    const items = [
      ...((await renderPage())
        .querySelector('[aria-labelledby="worker-trigger"]')
        ?.querySelectorAll("li") ?? []),
    ].map(text);
    expect(items).toEqual([
      `Problem JOBS_DEAD: 2 jobs became dead since ${dateTime("2026-11-03T04:17:00Z")}`,
      "Problem DISPATCHER_ERROR: error P0001: bad value 2026-13-45T99:99:99Z",
      `Warning EMAIL_HOLD: EMAIL_DAILY_QUOTA_EXCEEDED until ${dateTime("2026-11-04T00:01:00Z")} (3 emails waiting)`,
    ]);
    expect(items[2]).toContain("03:01");
    expect(items[0]).not.toContain("04:17:00Z");
    expect(items[2]).not.toContain("00:01:00Z");
  });

  it("shows a dispatch awaiting its response without the previous outcome", async () => {
    state.health = health({ pgNet: { outstandingRequestId: 42 } });
    const panel = text(
      (await renderPage()).querySelector('[aria-labelledby="worker-trigger"]'),
    );
    expect(panel).toContain(
      `Last dispatch: ${dateTime("2026-11-03T04:02:00+00:00")}, awaiting response`,
    );
    expect(panel).not.toContain("HTTP 200");
  });

  it("shows the last 20 worker runs", async () => {
    state.runs = Array.from({ length: 20 }, (_, index) =>
      index === 1
        ? run(2, {
            route: "maintenance",
            trigger: "vercel_cron",
            ok: false,
            error_code: "maintenance_failed",
            maintenance_status: "failed",
            stop_reason: null,
          })
        : run(index + 1),
    );
    const section = (await renderPage()).querySelector(
      '[aria-labelledby="worker-runs"]',
    );
    expect([...(section?.querySelectorAll("th") ?? [])].map(text)).toEqual([
      "Started",
      "Route",
      "Trigger",
      "Duration (s)",
      "Claimed",
      "Succeeded",
      "Failed",
      "Deferred",
      "Unclaimable",
      "Stop",
      "Result",
    ]);
    const rows = [...(section?.querySelectorAll("tbody tr") ?? [])].map((row) =>
      [...row.querySelectorAll("td")].map(text),
    );
    expect(rows).toHaveLength(20);
    expect(rows[0]).toEqual([
      dateTime("2026-11-03T04:10:00+00:00"),
      "jobs",
      "pg_cron",
      "7.0",
      "2",
      "2",
      "0",
      "0",
      "0",
      "queue_empty",
      "OK",
    ]);
    expect(rows[1].slice(1, 3)).toEqual(["maintenance", "vercel_cron"]);
    expect(rows[1].slice(-2)).toEqual(["—", "maintenance_failed (failed)"]);
  });

  it("keeps the jobs table when health or the run log cannot be read", async () => {
    state.healthError = true;
    state.runsError = true;
    const page = await renderPage();
    const alerts = [...page.querySelectorAll('[role="alert"]')].map(text);
    expect(alerts).toEqual([
      "Worker trigger health is unavailable.",
      "Recent worker runs are unavailable.",
    ]);
    expect(page.querySelectorAll('[role="status"]')).toHaveLength(0);
    const rows = [...page.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map(text),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(1, 4)).toEqual([
      "send_email",
      "investment · 88000000-0000-4000-8000-000000000000",
      "pending",
    ]);
  });

  it("treats a malformed health response as unavailable", async () => {
    state.health = { status: "ok" };
    const page = await renderPage();
    expect(text(page)).toContain("Worker trigger health is unavailable.");
  });

  it("offers Retry on a pending rate-limited email and shows its next check", async () => {
    state.jobs = [
      job("88000000-0000-4000-8000-000000000002", {
        last_error_code: "EMAIL_RATE_LIMITED",
        available_at: "2026-11-03T04:20:00+00:00",
      }),
      job("88000000-0000-4000-8000-000000000003", {
        status: "failed",
        attempts: 2,
        last_error_code: "EMAIL_DELIVERY_FAILED",
        available_at: "2026-11-03T04:45:00+00:00",
      }),
      job("88000000-0000-4000-8000-000000000004"),
    ];
    const rows = [...(await renderPage()).querySelectorAll("tbody tr")]
      .map((row) => [...row.querySelectorAll("td")].map(text))
      .filter((cells) => cells.length === 10);
    expect(rows.map((cells) => [cells[6], cells[9]])).toEqual([
      [dateTime("2026-11-03T04:20:00+00:00"), "Retry"],
      [dateTime("2026-11-03T04:45:00+00:00"), "Retry"],
      ["—", ""],
    ]);
  });
});
