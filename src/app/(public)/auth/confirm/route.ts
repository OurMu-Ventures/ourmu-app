import { NextResponse } from "next/server";

import { decidePostLoginDestination } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

// Fallback carrier for the requested destination, set by the login action
// in case the email provider strips query parameters from the callback URL.
// Always re-validated before use; cleared on every callback outcome.
const PENDING_NEXT_COOKIE = "pending_next";

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

  const code = url.searchParams.get("code");
  if (!code) return fail("invalid_link");
  const supabase = await createClient();
  const { error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return fail("invalid_link");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = user
    ? await supabase
        .from("profiles")
        .select("role,access_status")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null, error: null };

  let aal2 = false;
  if (!profileError && profile?.role === "admin") {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    aal2 = data?.currentLevel === "aal2";
  }
  // Transient lookup failures must not read as missing profiles.
  const decision = decidePostLoginDestination({
    profile: profileError ? null : profile,
    aal2,
    rawNext: url.searchParams.get("next") ?? readPendingNext(request),
  });
  if (decision.kind === "error") {
    await supabase.auth.signOut({ scope: "local" });
    const errorCode =
      decision.code === "no_profile" && profileError
        ? "invalid_link"
        : decision.code;
    return fail(errorCode);
  }
  return finish(decision.to);
}
