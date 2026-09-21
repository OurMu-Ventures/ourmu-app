import { NextResponse } from "next/server";

import {
  extractConfirmPayload,
  isInvalidOrExpiredError,
  logAuthVerificationOutcome,
} from "@/lib/auth-links";
import { getPublicEnv } from "@/lib/env";
import { decidePostLoginDestination } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

const PENDING_NEXT_COOKIE = "pending_next";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function readPendingNext(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const match = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${PENDING_NEXT_COOKIE}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(PENDING_NEXT_COOKIE.length + 1));
  } catch {
    return null;
  }
}

async function loadSessionContext(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, profileError: null, aal2: false };
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,access_status")
    .eq("id", user.id)
    .maybeSingle();
  let aal2 = false;
  if (!profileError && profile?.role === "admin") {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal2 = data?.currentLevel === "aal2";
  }
  return { user, profile, profileError, aal2 };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const finish = (to: string) => {
    const response = NextResponse.redirect(new URL(to, url.origin));
    response.cookies.delete(PENDING_NEXT_COOKIE);
    return response;
  };
  const fail = (errorCode: "invalid_link" | "disabled_access" | "no_profile") => {
    const login = new URL("/login", url.origin);
    login.searchParams.set("error", errorCode);
    const response = NextResponse.redirect(login);
    response.cookies.delete(PENDING_NEXT_COOKIE);
    return response;
  };

  const supabase = await createClient();
  const rawNext = url.searchParams.get("next") ?? readPendingNext(request);

  // Session-aware: a repeat click in the same browser already holds a session,
  // so redirect without attempting to redeem the one-time token again.
  const existing = await loadSessionContext(supabase);
  if (existing.user) {
    const decision = decidePostLoginDestination({
      profile: existing.profileError ? null : existing.profile,
      aal2: existing.aal2,
      rawNext,
    });
    if (decision.kind === "error") {
      await supabase.auth.signOut({ scope: "local" });
      if (decision.code === "disabled_access") {
        logAuthVerificationOutcome("disabled_access");
        return fail("disabled_access");
      }
      logAuthVerificationOutcome("invalid_or_expired");
      return fail("invalid_link");
    }
    logAuthVerificationOutcome("already_authenticated");
    return finish(decision.to);
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  if (!code && !tokenHash) {
    logAuthVerificationOutcome("invalid_or_expired");
    return fail("invalid_link");
  }
  if (tokenHash && type && type !== "magiclink") {
    logAuthVerificationOutcome("invalid_or_expired");
    return fail("invalid_link");
  }

  let exchangeError: unknown = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = error;
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    exchangeError = error;
  }
  if (exchangeError) {
    // Supabase does not reliably distinguish "already used" from "expired",
    // so both map to the same non-enumerating recovery screen.
    logAuthVerificationOutcome("invalid_or_expired");
    return fail("invalid_link");
  }

  const session = await loadSessionContext(supabase);
  const decision = decidePostLoginDestination({
    profile: session.profileError ? null : session.profile,
    aal2: session.aal2,
    // Re-validate the destination after redemption; decide* sanitizes again.
    rawNext,
  });
  if (decision.kind === "error") {
    await supabase.auth.signOut({ scope: "local" });
    const errorCode =
      decision.code === "no_profile" && session.profileError
        ? "invalid_link"
        : decision.code;
    if (errorCode === "disabled_access") {
      logAuthVerificationOutcome("disabled_access");
    } else {
      logAuthVerificationOutcome("invalid_or_expired");
    }
    return fail(errorCode);
  }
  logAuthVerificationOutcome("redeemed");
  return finish(decision.to);
}

type PostBody = {
  code?: unknown;
  token_hash?: unknown;
  type?: unknown;
  next?: unknown;
  confirmationUrl?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  return trimmed;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const json = (body: Record<string, unknown>, status: number) => {
    const response = NextResponse.json(body, { status });
    response.cookies.delete(PENDING_NEXT_COOKIE);
    return response;
  };
  const invalid = () => {
    logAuthVerificationOutcome("invalid_or_expired");
    return json(
      { ok: false, code: "invalid_link", redirectTo: "/login?error=invalid_link" },
      400,
    );
  };

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return invalid();
  }

  let code = asNonEmptyString(body.code);
  let tokenHash = asNonEmptyString(body.token_hash);
  let verifyType = asNonEmptyString(body.type);
  let rawNext: unknown = typeof body.next === "string" ? body.next : null;

  // Allow the client to POST the full fragment URL; validate it with the same
  // allowlist used on the client (host, path, verification type, target).
  const confirmationUrlRaw =
    typeof body.confirmationUrl === "string" ? body.confirmationUrl.trim() : null;
  if (confirmationUrlRaw) {
    let supabaseOrigin: string | null = null;
    try {
      supabaseOrigin = getPublicEnv().NEXT_PUBLIC_SUPABASE_URL;
    } catch {
      supabaseOrigin = null;
    }
    const decision = extractConfirmPayload(confirmationUrlRaw, {
      appOrigin: url.origin,
      supabaseOrigin,
    });
    if (decision.kind === "invalid") return invalid();
    if (decision.kind === "supabase") {
      // Supabase verify URLs require a deliberate top-level navigation, not a
      // same-origin POST. Tell the client where to continue.
      return json(
        {
          ok: false,
          code: "supabase_navigation_required",
          redirectTo: decision.next ?? "/dashboard",
          navigateTo: decision.supabaseUrl,
        },
        409,
      );
    }
    const payload = decision.payload;
    rawNext = payload.next ?? rawNext;
    if (payload.kind === "code") {
      code = payload.code;
      tokenHash = null;
      verifyType = null;
    } else {
      tokenHash = payload.token_hash;
      verifyType = payload.type;
      code = null;
    }
  }

  if (rawNext == null) rawNext = readPendingNext(request);

  const supabase = await createClient();

  // Already signed in (repeat click in the same browser): do not redeem.
  const existing = await loadSessionContext(supabase);
  if (existing.user) {
    const decision = decidePostLoginDestination({
      profile: existing.profileError ? null : existing.profile,
      aal2: existing.aal2,
      rawNext,
    });
    if (decision.kind === "error") {
      await supabase.auth.signOut({ scope: "local" });
      if (decision.code === "disabled_access") {
        logAuthVerificationOutcome("disabled_access");
        return json(
          {
            ok: false,
            code: "disabled_access",
            redirectTo: "/login?error=disabled_access",
          },
          403,
        );
      }
      return invalid();
    }
    logAuthVerificationOutcome("already_authenticated");
    return json(
      { ok: true, redirectTo: decision.to, alreadyAuthenticated: true },
      200,
    );
  }

  if (!code && !tokenHash) return invalid();
  if (code && tokenHash) return invalid();
  if (tokenHash && verifyType && verifyType !== "magiclink") return invalid();

  let exchangeError: unknown = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = error;
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    });
    exchangeError = error;
  }
  if (exchangeError) {
    if (!isInvalidOrExpiredError(exchangeError)) {
      logAuthVerificationOutcome("invalid_or_expired");
    } else {
      logAuthVerificationOutcome("invalid_or_expired");
    }
    return invalid();
  }

  const session = await loadSessionContext(supabase);
  const decision = decidePostLoginDestination({
    profile: session.profileError ? null : session.profile,
    aal2: session.aal2,
    rawNext,
  });
  if (decision.kind === "error") {
    await supabase.auth.signOut({ scope: "local" });
    if (decision.code === "disabled_access") {
      logAuthVerificationOutcome("disabled_access");
      return json(
        {
          ok: false,
          code: "disabled_access",
          redirectTo: "/login?error=disabled_access",
        },
        403,
      );
    }
    logAuthVerificationOutcome("invalid_or_expired");
    return json(
      {
        ok: false,
        code: decision.code,
        redirectTo: `/login?error=${decision.code === "no_profile" ? "no_profile" : "invalid_link"}`,
      },
      401,
    );
  }
  logAuthVerificationOutcome("redeemed");
  return json({ ok: true, redirectTo: decision.to }, 200);
}
