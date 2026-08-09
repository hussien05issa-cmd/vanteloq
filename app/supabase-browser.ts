"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://wqiwmpqnthshgyxpettl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_756K45Ii9HTN4fk9ZtIUew_ap8XBaDp";

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  clientPromise = Promise.resolve(createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // Passwords are never stored by this client. A rich browser application
      // must be able to read its session token; Supabase keeps the access JWT
      // short-lived and rotates the persisted refresh token. PKCE prevents an
      // intercepted email authorization code from being redeemed without the
      // verifier held by the browser that started the flow.
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
  return clientPromise;
}

export async function currentSession(): Promise<Session | null> {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const session = await currentSession();
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}

export async function signOut(): Promise<void> {
  const supabase = await getSupabase();
  if (supabase) await supabase.auth.signOut();
}
