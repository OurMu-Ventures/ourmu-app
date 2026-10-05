import "server-only";

const deadlines = new WeakMap<
  AbortSignal,
  { controller: AbortController; expiresAt: number }
>();

export function assertOperationActive(signal: AbortSignal): void {
  const deadline = deadlines.get(signal);
  // Check wall time too: synchronous PDF work can delay the timer callback.
  if (deadline && Date.now() >= deadline.expiresAt && !signal.aborted)
    deadline.controller.abort(new Error("JOB_OPERATION_TIMEOUT"));
  signal.throwIfAborted();
}

// Cooperative cancellation prevents a late operation from beginning another
// side effect. Fetches also receive this signal; CPU-bound PDF generation may
// finish, but cannot upload, update records or enqueue mail after cancellation.
export async function runBoundedOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  deadlines.set(controller.signal, {
    controller,
    expiresAt: Date.now() + timeoutMs,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        assertOperationActive(controller.signal);
        return operation(controller.signal);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("JOB_OPERATION_TIMEOUT");
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort(new Error("JOB_OPERATION_FINISHED"));
  }
}

// Guard lazy PostgREST builders and eager Storage/RPC calls, including results
// arriving after cancellation. Methods retain their original receiver.
export function guardOperation<T extends object>(
  target: T,
  signal: AbortSignal,
): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key, object);
      if (typeof value === "function") {
        if (key === "then")
          return (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => {
            Promise.resolve()
              .then(() => {
                assertOperationActive(signal);
                return new Promise((yes, no) => value.call(object, yes, no));
              })
              .then((result) => {
                assertOperationActive(signal);
                return result;
              })
              .then(resolve, reject);
          };
        return (...args: unknown[]) => {
          assertOperationActive(signal);
          const result = value.apply(object, args);
          return result && typeof result === "object"
            ? guardOperation(result, signal)
            : result;
        };
      }
      return value && typeof value === "object"
        ? guardOperation(value, signal)
        : value;
    },
  });
}
