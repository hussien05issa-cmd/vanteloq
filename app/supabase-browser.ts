"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

let clientPromise: Promise<SupabaseClient | null> | null = null;

export function getSupabase(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;
  clientPromise = fetch("/api/v1/auth/config", { headers: { Accept: "application/json" } })
    .then(async response => {
      if (!response.ok) return null;
      const config = await response.json() as { url?: unknown; publishableKey?: unknown };
      if (typeof config.url !== "string" || typeof config.publishableKey !== "string") return null;
      return createClient(config.url, config.publishableKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })
    .catch(() => null);
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
  window.location.reload();
}
