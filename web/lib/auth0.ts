import { Auth0Client } from "@auth0/nextjs-auth0/server";

// Auth0 is on when its env is present (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET, APP_BASE_URL).
// Without it the app falls back to Supabase email login only, instead of crashing at import.
export const auth0 = process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && process.env.AUTH0_SECRET
  ? new Auth0Client({ authorizationParameters: { scope: "openid profile email" } })
  : null;
