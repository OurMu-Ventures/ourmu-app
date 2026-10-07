// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/actions/newsletters", () => ({ recordNewsletterVisit: record }));
import { NewsletterReadTracker } from "@/components/NewsletterReadTracker";

let visible: DocumentVisibilityState;
let observeEnd: IntersectionObserverCallback;
beforeEach(() => {
  vi.useFakeTimers();
  visible = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible);
  record.mockReset().mockResolvedValue(true);
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { observeEnd = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount() {
  await act(async () => { render(<NewsletterReadTracker slug="october-2026"><p>Newsletter</p></NewsletterReadTracker>); });
}
async function tick(seconds: number) { await act(async () => { await vi.advanceTimersByTimeAsync(seconds * 1000); }); }
async function end() {
  await act(async () => { observeEnd([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
}
const completions = () => record.mock.calls.filter(([input]) => input.event === "reached_end");

describe("newsletter reading signals", () => {
  it("waits for a visible page before counting an open", async () => {
    visible = "hidden";
    await mount(); await tick(40);
    expect(record).not.toHaveBeenCalled();
    visible = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].event).toBe("opened");
  });
  it("requires both the end of the newsletter and 30 visible seconds", async () => {
    await mount(); await end(); await tick(29);
    expect(completions()).toHaveLength(0);
    await tick(1);
    expect(completions()).toHaveLength(1);
    await tick(60); await end();
    expect(completions()).toHaveLength(1);
  });
  it("does not count background time or complete without reaching the bottom", async () => {
    await mount(); await tick(20);
    visible = "hidden"; await tick(60);
    visible = "visible"; await tick(10);
    expect(completions()).toHaveLength(0);
    await end();
    expect(completions()).toHaveLength(1);
  });
  it("reuses a visit ID across Strict Mode effect retries", async () => {
    await act(async () => { render(<StrictMode><NewsletterReadTracker slug="october-2026">Issue</NewsletterReadTracker></StrictMode>); });
    const ids = record.mock.calls.map(([input]) => input.visitId);
    expect(new Set(ids).size).toBe(1);
  });
  it("recognizes the visible end after returning from a background tab", async () => {
    await mount();
    visible = "hidden";
    await end(); await tick(60);
    expect(completions()).toHaveLength(0);
    visible = "visible";
    await tick(30);
    expect(completions()).toHaveLength(1);
  });
  it("limits failed tracking retries and keeps content mounted", async () => {
    record.mockRejectedValue(new Error("offline"));
    await mount(); await tick(60);
    expect(record).toHaveBeenCalledTimes(3);
    expect(document.body).toHaveTextContent("Newsletter");
  });
});
