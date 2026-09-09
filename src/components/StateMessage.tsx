import type { ActionState } from "@/lib/validation";
export function StateMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <>
      <p
        className={state.ok ? "success" : "error"}
        role={state.ok ? "status" : "alert"}
      >
        {state.message}
      </p>
      {state.ok && state.sensitiveAction && (
        <div className="notice" role="status">
          <a href={state.sensitiveAction.url} rel="noreferrer">
            {state.sensitiveAction.label}
          </a>
          <p>
            <small>
              Controlled testing only. Share this one-time link privately with
              the intended recipient, then reload this page to remove it.
            </small>
          </p>
        </div>
      )}
    </>
  );
}
