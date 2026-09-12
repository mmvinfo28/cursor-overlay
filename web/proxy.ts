import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { auth0 } from "@/lib/auth0";

// Auth0 owns /auth/* (login, callback, logout) and refreshes its session cookie; Supabase refreshes its own.
// The dashboard needs one of the two sessions. API routes are open: the desktop overlay has no browser session.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });
  let auth0User = false;
  if (auth0) {
    response = await auth0.middleware(request);
    if (pathname.startsWith("/auth/")) return response;
    auth0User = !!(await auth0.getSession(request))?.user;
  }
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        all.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        all.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = auth0User || !!user;
  const open = pathname === "/" || pathname.startsWith("/walkthrough") || pathname.startsWith("/login") || pathname.startsWith("/supabase") || pathname.startsWith("/api");

  if (!signedIn && !open) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  if (pathname === "/results") {                        // old link
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard/results";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
