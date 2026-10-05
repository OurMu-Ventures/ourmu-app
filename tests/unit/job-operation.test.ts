import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { guardOperation, runBoundedOperation } from "@/lib/jobs/operation";
afterEach(() => vi.useRealTimers());
describe("job cancellation", () => {
  it("prevents resumed PDF work from uploading or queuing after timeout", async () => {
    vi.useFakeTimers();
    let resume!: () => void;
    const delayedPdf = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const upload = vi.fn();
    const enqueue = vi.fn();
    let finished!: Promise<void>;
    const bounded = runBoundedOperation(async (signal) => {
      const client = guardOperation({ storage: { upload }, enqueue }, signal);
      finished = (async () => {
        await delayedPdf;
        client.storage.upload();
        client.enqueue();
      })();
      return finished;
    }, 10);
    const rejected = expect(bounded).rejects.toThrow("JOB_OPERATION_TIMEOUT");
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    resume();
    await expect(finished).rejects.toThrow("JOB_OPERATION_TIMEOUT");
    expect(upload).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it("checks wall time when synchronous work delays the timer callback", async () => {
    vi.useFakeTimers();
    const upload = vi.fn();
    await expect(
      runBoundedOperation(async (signal) => {
        const client = guardOperation({ upload }, signal);
        vi.setSystemTime(Date.now() + 20);
        client.upload();
      }, 10),
    ).rejects.toThrow("JOB_OPERATION_TIMEOUT");
    expect(upload).not.toHaveBeenCalled();
  });
  it("blocks a lazy query that has not executed when cancellation happens", async () => {
    const controller = new AbortController();
    const execute = vi.fn((resolve: (v: unknown) => unknown) =>
      resolve({ data: [] }),
    );
    const query = guardOperation({ then: execute }, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(Promise.resolve(query)).rejects.toThrow("cancelled");
    expect(execute).not.toHaveBeenCalled();
  });
});
