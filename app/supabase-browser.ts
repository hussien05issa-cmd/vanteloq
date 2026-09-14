"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { createSessionReader } from "./browser-session";

const SUPABASE_URL = "https://wqiwmpqnthshgyxpettl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_756K45Ii9HTN4fk9ZtIUew_ap8XBaDp";

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Passwords are never stored by this client. A rich browser application
      // must be able to read its session token; Supabase keeps the access JWT
      // short-lived and rotates the persisted refresh token. Account creation,
      // confirmation resends and recovery all start through this same client,
      // so their PKCE verifier is available when the email callback returns.
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  // Keep this callback synchronous. A valid auth-event snapshot avoids repeated
  // SDK session work for every dashboard, privacy and AI request.
  client.auth.onAuthStateChange((_event, session) => { sessionReader.update(session); });
  clientPromise = Promise.resolve(client);
  return clientPromise;
}

async function readFreshSession(): Promise<Session | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    const staleRefreshToken = error.code === "refresh_token_not_found"
      || /refresh token.*(?:not found|invalid|expired)/i.test(error.message);
    if (staleRefreshToken) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      return null;
    }
    throw error;
  }
  return data.session;
}

const sessionReader = createSessionReader(readFreshSession);
export function currentSession(): Promise<Session | null> { return sessionReader.read(); }

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  init.signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  const session = await currentSession();
  init.signal?.throwIfAborted();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  if (supabase) await supabase.auth.signOut();
}
