"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Pencil } from "lucide-react";

import { renameInvestment } from "@/actions/investments";

export function InvestmentAlias({
  investmentId,
  alias,
  defaultTitle,
}: {
  investmentId: string;
  alias: string | null;
  defaultTitle: string;
}) {
  const [saved, setSaved] = useState(alias);
  const [draft, setDraft] = useState(alias ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  const cancel = () => {
    setDraft(saved ?? "");
    setError("");
    setEditing(false);
  };
  const save = (value = draft) => {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await renameInvestment({ investmentId, alias: value });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setSaved(result.alias);
        setDraft(result.alias ?? "");
        setEditing(false);
      } catch {
        setError("Could not save the name. Try again.");
      }
    });
  };

  if (!editing)
    return (
      <h3 className="investment-alias-heading">
        <button
          type="button"
          className="investment-alias-title"
          onClick={() => setEditing(true)}
          aria-label={`Rename investment ${saved || defaultTitle}`}
        >
          <span>{saved || defaultTitle}</span>
          <Pencil size={16} aria-hidden="true" />
        </button>
      </h3>
    );

  return (
    <div className="investment-alias-editor">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <input
          ref={input}
          type="text"
          aria-label="Investment name"
          maxLength={80}
          value={draft}
          placeholder={defaultTitle}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          disabled={pending}
        />
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={cancel} disabled={pending}>
          Cancel
        </button>
      </form>
      {saved && (
        <button
          type="button"
          className="investment-alias-reset"
          onClick={() => save("")}
          disabled={pending}
        >
          Use default name
        </button>
      )}
      {error && (
        <p role="alert" className="investment-alias-error">
          {error}
        </p>
      )}
    </div>
  );
}
