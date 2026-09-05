import type { ActionState } from "@/lib/validation";
export function StateMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p
      className={state.ok ? "success" : "error"}
      role={state.ok ? "status" : "alert"}
    >
      {state.message}
    </p>
  );
}
