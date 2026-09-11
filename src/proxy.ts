import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const protectedPrefixes = [
  "/dashboard",
  "/profile",
  "/investments",
  "/agreements",
  "/account",
  "/admin",
];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  if (
    !data?.claims &&
    protectedPrefixes.some((prefix) =>
      request.nextUrl.pathname.startsWith(prefix),
    )
  ) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  // Administrators must hold AAL2 for /admin routes. Bounce AAL1 sessions
  // to MFA carrying the requested page; the MFA page re-verifies the admin
  // role, so investors loop out to /dashboard without seeing anything.
  const pathname = request.nextUrl.pathname;
  const isAdminRoute =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const isMfaPage =
    pathname === "/admin/mfa" || pathname.startsWith("/admin/mfa/");
  if (data?.claims && isAdminRoute && !isMfaPage) {
    const { data: aal } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      const mfa = request.nextUrl.clone();
      mfa.pathname = "/admin/mfa";
      mfa.searchParams.set("next", pathname);
      return NextResponse.redirect(mfa);
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
