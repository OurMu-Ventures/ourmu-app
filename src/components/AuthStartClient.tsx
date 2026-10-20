"use client";

import { useEffect, useRef, useState } from "react";

import { MagicLinkForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import {
  extractStartPayloadFromHash,
  type ConfirmPayload,
} from "@/lib/auth-links";

type Status =
  | { name: "loading" }
  | { name: "ready"; payload: ConfirmPayload }
  | { name: "supabase"; supabaseUrl: string }
  | { name: "working" }
  | { name: "invalid" }
  | { name: "failed" };

function clearFragment() {
  try {
    const url = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", url);
  } catch {
    // History cleanup is best-effort; the token was only in the fragment.
  }
}

export function AuthStartClient() {
  // Match the server render, then read the browser-only fragment after mount.
  // The server's loading state can be reused during hydration, so parsing in
  // the state initializer can leave the page permanently loading.
  const [status, setStatus] = useState<Status>({ name: "loading" });
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    // Strict Mode replays effects. Preserve the first result after removing
    // the fragment rather than treating the second pass as a missing link.
    if (initialized.current) return;
    initialized.current = true;
    const decision = extractStartPayloadFromHash(window.location.hash, {
      appOrigin: window.location.origin,
      supabaseOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    });
    clearFragment();
    const initialStatus: Status =
      decision.kind === "confirm"
        ? { name: "ready", payload: decision.payload }
        : decision.kind === "supabase"
          ? { name: "supabase", supabaseUrl: decision.supabaseUrl }
          : { name: "invalid" };
    // Synchronize the server placeholder with the browser's external URL state.
    setStatus(initialStatus);
  }, []);

  const continueSecurely = async () => {
    if (status.name === "supabase") {
      // Deliberate navigation: the Supabase verify endpoint consumes the
      // one-time token and redirects to /auth/confirm, which is session-aware.
      window.location.href = status.supabaseUrl;
      return;
    }
    if (status.name !== "ready") return;
    setStatus({ name: "working" });
    setError(null);
    const payload = status.payload;
    const body =
      payload.kind === "code"
        ? { code: payload.code, next: payload.next }
        : {
            token_hash: payload.token_hash,
            type: payload.type,
            next: payload.next,
          };
    let response: Response;
    try {
      response = await fetch("/auth/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } catch {
      setStatus({ name: "failed" });
      setError("We could not reach the sign-in service. Try again.");
      return;
    }
    let data: {
      ok?: boolean;
      redirectTo?: string;
      navigateTo?: string;
      code?: string;
    } | null = null;
    try {
      data = (await response.json()) as {
        ok?: boolean;
        redirectTo?: string;
        navigateTo?: string;
        code?: string;
      };
    } catch {
      data = null;
    }
    if (data?.navigateTo) {
      window.location.href = data.navigateTo;
      return;
    }
    if (response.ok && data?.ok && data.redirectTo) {
      window.location.href = data.redirectTo;
      return;
    }
    if (data?.redirectTo) {
      window.location.href = data.redirectTo;
      return;
    }
    setStatus({ name: "failed" });
  };

  if (status.name === "loading" || status.name === "working") {
    return (
      <div className="card">
        <p className="muted" role="status">
          {status.name === "loading"
            ? "Checking your secure link…"
            : "Signing you in securely…"}
        </p>
      </div>
    );
  }

  if (status.name === "invalid" || status.name === "failed") {
    return (
      <div>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p className="error" role="alert">
            This link has already been used or has expired. For your security,
            each sign-in link works once.
          </p>
          {error && (
            <p className="muted" role="status">
              {error}
            </p>
          )}
        </div>
        <div className="card">
          <MagicLinkForm submitLabel="Email me a fresh link" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <p className="muted">
          To keep your account safe, we haven&rsquo;t signed you in yet.
          Continue when you&rsquo;re ready&mdash;this link expires one hour
          after it was requested and works once. No fishy business.
        </p>
        <div className="hero-actions" style={{ marginTop: "1rem" }}>
          <Button type="button" onClick={continueSecurely}>
            Continue securely
          </Button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: "0.875rem" }}>
        Need a new link?{" "}
        <a href="/login">Request one from the login page</a>.
      </p>
    </div>
  );
}
