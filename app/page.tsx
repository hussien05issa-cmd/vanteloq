"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import SessionTimeout from "./session-timeout";
import { setPublicRoot } from "./analytics-public-surface";
import HomepageLanding from "./homepage-landing";
import ClientLoadBoundary from "./client-load-boundary";
import WorkspaceSkeleton from "./workspace-skeleton";
import ProductBrandLogo from "./product-brand-logo";
import type { AuthPanelMode } from "./auth-panel";
import { useModalFocus } from "./use-modal-focus";
import { currentSession, getSupabase, signOut } from "./supabase-browser";
import { readPlanSelection } from "../shared/plan-selection";
import { canonicalLocation } from "../shared/auth-urls";
import {
  clearTeamInviteCallback,
  parseTeamInviteCallback,
  type TeamInviteCallback,
} from "../shared/team-invite-auth";
import type { ComplimentaryWorkspaceOffer } from "./complimentary-workspace-flow";
import type { TeamInvitationDetails } from "./team-invitation-flow";

const AuthPanel = lazy(() => import("./auth-panel"));
const ComplimentaryWorkspaceFlow = lazy(() => import("./complimentary-workspace-flow"));
const SecureOnboardingFlow = lazy(() => import("./secure-onboarding-flow"));
const VanteloqApp = lazy(() => import("./vanteloq-app"));
const AccountMfaGate = lazy(() => import("./founder-mfa-gate"));
const BillingOnboardingGate = lazy(() => import("./billing-onboarding-gate"));
const LegalAcceptanceGate = lazy(() => import("./legal-acceptance-gate"));
const TeamInvitationFlow = lazy(() => import("./team-invitation-flow"));

export default function Home() {
  const canonicalDestination = typeof window === "undefined" ? null : canonicalLocation(window.location);
  const [entry, setEntry] = useState<"loading" | "load-error" | "landing" | "invite-review" | "signup" | "invitation" | "app">("landing");
  const [authOpen, setAuthOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [authMode, setAuthMode] = useState<AuthPanelMode>("signup");
  const [organizationName, setOrganizationName] = useState("");
  const [accountName, setAccountName] = useState("Account owner");
  const [accountEmail, setAccountEmail] = useState("");
  const [loadError, setLoadError] = useState("");
  const [complimentaryOffer, setComplimentaryOffer] = useState<ComplimentaryWorkspaceOffer | null>(null);
  const [teamInvitation, setTeamInvitation] = useState<TeamInvitationDetails | null>(null);
  const [inviteCallback, setInviteCallback] = useState<TeamInviteCallback | null>(null);
  const [inviteVerificationBusy, setInviteVerificationBusy] = useState(false);
  const [inviteVerificationError, setInviteVerificationError] = useState("");
  const loadSequence = useRef(0);
  const loadingUser = useRef<string | null>(null);
  const loadedUser = useRef<string | null>(null);
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);

  useEffect(() => {
    setPublicRoot(signedOut && entry === "landing" && !authOpen && !canonicalDestination);
    return () => setPublicRoot(false);
  }, [signedOut, entry, authOpen, canonicalDestination]);

  useEffect(() => {
    if (canonicalDestination) window.location.replace(canonicalDestination);
  }, [canonicalDestination]);

  const cancelPendingLoad = useCallback(() => {
    ++loadSequence.current;
    loadingUser.current = null;
  }, []);

  const loadWorkspace = useCallback(async (session: Session | null) => {
    setPublicRoot(false);
    setSignedOut(!session);
    if (!session) {
      ++loadSequence.current;
      loadingUser.current = null;
      loadedUser.current = null;
      setWorkspaceUserId(null);
      setLoadError("");
      setComplimentaryOffer(null);
      setEntry("landing");
      return;
    }
    const userId = session.user.id;
    if (loadingUser.current === userId || loadedUser.current === userId) return;
    const sequence = ++loadSequence.current;
    loadingUser.current = userId;

    setEntry("loading");
    setLoadError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch("/api/v1/onboarding", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as {
        authenticated?: boolean;
        user?: { email?: string; displayName?: string };
        organization?: { setupComplete?: boolean; businessName?: string; ownerName?: string } | null;
        invitation?: TeamInvitationDetails | null;
        complimentary?: ComplimentaryWorkspaceOffer | null;
        error?: { code?: string; message?: string };
      };
      if (sequence !== loadSequence.current) return;
      if (response.status === 401 && data.error?.code === "SESSION_EXPIRED") {
        const client = await getSupabase();
        await client?.auth.signOut({ scope: "local" });
        setAuthMode("signin");
        setAuthOpen(true);
        return;
      }

      if (response.ok && data.organization?.setupComplete && !data.invitation) {
        loadedUser.current = userId;
        setWorkspaceUserId(userId);
        setAccountEmail(data.user?.email ?? "");
        setOrganizationName(data.organization.businessName ?? "");
        setAccountName(data.organization.ownerName || data.user?.displayName || "Account owner");
        setEntry("app");
        return;
      }
      if (response.ok && data.invitation) {
        loadedUser.current = userId;
        setWorkspaceUserId(userId);
        setAccountEmail(data.user?.email ?? "");
        setAccountName(data.user?.displayName || "Team member");
        setTeamInvitation(data.invitation);
        setEntry("invitation");
        return;
      }
      if (response.ok && data.authenticated) {
        setComplimentaryOffer(data.complimentary ?? null);
        loadedUser.current = userId;
        setWorkspaceUserId(userId);
        setAccountEmail(data.user?.email ?? "");
        setAccountName(data.user?.displayName || "Account owner");
        setEntry("signup");
        return;
      }

      setLoadError(data.error?.code === "IDENTITY_CONFLICT" ? data.error.message ?? "Sign in with your original account or contact support@vanteloq.com for account recovery." : response.status === 401
        ? "Your sign-in could not be verified. Try again, or sign out and sign in once more."
        : "Your workspace could not be loaded. Your account is safe; try again in a moment.");
      setEntry("load-error");
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(error instanceof DOMException && error.name === "AbortError"
        ? "Vanteloq took too long to load. Check your connection and try again."
        : "Vanteloq could not load your workspace. Check your connection and try again.");
      setEntry("load-error");
    } finally {
      window.clearTimeout(timeout);
      if (sequence === loadSequence.current) loadingUser.current = null;
    }
  }, []);

  useEffect(() => {
    if (canonicalDestination) return;
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const recoveryRequested = query.get("recovery") === "1";
    const inviteRequested = query.get("team_invite") === "1";
    const callback = parseTeamInviteCallback(window.location.href);
    readPlanSelection();
    const requestedStart = query.get("start");
    const requestedAuth = query.get("auth");
    const requestedMode = requestedStart === "signup" || requestedStart === "signin"
      ? requestedStart
      : requestedAuth === "signup" || requestedAuth === "signin"
        ? requestedAuth
        : null;
    if (callback) {
      queueMicrotask(() => {
        if (!active) return;
        setInviteCallback(callback);
        setInviteVerificationError("");
        setEntry("invite-review");
      });
    } else if (recoveryRequested) {
      queueMicrotask(() => {
        if (!active) return;
        setEntry("landing");
        setAuthMode("reset-password");
        setAuthOpen(true);
      });
    } else {
      void currentSession()
        .then(session => {
          if (!active) return;
          if (session) {
            void loadWorkspace(session);
            return;
          }
          setSignedOut(true);
          if (inviteRequested) {
            setEntry("landing");
            setAuthMode("signin");
            setAuthOpen(true);
            return;
          }
          setEntry("landing");
          if (requestedMode) {
            setAuthMode(requestedMode);
            setAuthOpen(true);
          }
        })
        .catch(() => {
          if (!active) return;
          setLoadError("Vanteloq could not check your sign-in. Check your connection and try again.");
          setEntry("load-error");
        });
    }
    let unsubscribe: (() => void) | undefined;
    void getSupabase().then(client => {
      if (!active) return;
      const listener = client?.auth.onAuthStateChange((event, session) => {
        if (session || event === "PASSWORD_RECOVERY") {
          setPublicRoot(false);
          setSignedOut(false);
        }
        if (event === "PASSWORD_RECOVERY") {
          setEntry("landing");
          setAuthMode("reset-password");
          setAuthOpen(true);
        }
        if (event === "SIGNED_IN" && new URLSearchParams(window.location.search).get("recovery") !== "1") {
          setAuthOpen(false);
          window.setTimeout(() => { if (active) void loadWorkspace(session); }, 0);
        }
        if (event === "SIGNED_OUT") {
          setSignedOut(true);
          cancelPendingLoad();
          loadedUser.current = null;
          setWorkspaceUserId(null);
          setOrganizationName("");
          setAccountEmail("");
          setTeamInvitation(null);
          setEntry("landing");
        }
      });
      unsubscribe = () => listener?.data.subscription.unsubscribe();
    });
    return () => {
      active = false;
      cancelPendingLoad();
      unsubscribe?.();
    };
  }, [cancelPendingLoad, loadWorkspace, canonicalDestination]);

  async function verifyTeamInvite() {
    if (!inviteCallback || inviteVerificationBusy) return;
    setInviteVerificationBusy(true);
    setInviteVerificationError("");
    try {
      const client = await getSupabase();
      if (!client) throw new Error("Secure invitation verification is temporarily unavailable.");
      const { data, error } = await client.auth.verifyOtp({
        token_hash: inviteCallback.tokenHash,
        type: inviteCallback.type,
      });
      if (error || !data.session) throw new Error("This invitation has expired or was already used. Ask the owner to send a new invitation.");
      window.history.replaceState({}, document.title, clearTeamInviteCallback(window.location.href));
      setInviteCallback(null);
      await loadWorkspace(data.session);
    } catch (error) {
      setInviteVerificationError(error instanceof Error ? error.message : "The invitation could not be verified.");
    } finally {
      setInviteVerificationBusy(false);
    }
  }

  if (entry === "loading") return <AuthenticatedLoading/>;
  if (entry === "load-error") return <main className="entry-loading entry-load-error">
    <ProductBrandLogo product="vanteloq" priority/>
    <h1>Vanteloq did not finish loading</h1>
    <p>{loadError}</p>
    <div>
      <button onClick={() => void currentSession().then(loadWorkspace)}>Try again</button>
      <button className="secondary" onClick={() => void signOut()}>Sign out</button>
    </div>
  </main>;
  if (entry === "invite-review") return <main className="entry-loading entry-load-error team-invite-review">
    <ProductBrandLogo product="vanteloq" priority/>
    <p className="eyebrow">OWNER APPROVED TEAM ACCESS</p>
    <h1>Review your secure invitation</h1>
    <p>This invitation provides internal Vanteloq workspace access without checkout and includes private console access when assigned by the owner.</p>
    <p>No Stripe customer or paid subscription is created.</p>
    {inviteVerificationError && <p role="alert">{inviteVerificationError}</p>}
    {inviteCallback && <button disabled={inviteVerificationBusy} onClick={() => void verifyTeamInvite()}>{inviteVerificationBusy ? "Verifying securely…" : "Accept invitation and continue"}</button>}
  </main>;
  function openAuth(mode: "signin" | "signup") {
    setPublicRoot(false);
    setAuthMode(mode);
    setAuthOpen(true);
  }

  function closeAuth() {
    if (authMode === "reset-password") window.history.replaceState({}, "", window.location.pathname);
    const clean = new URL(window.location.href);
    clean.searchParams.delete("start"); clean.searchParams.delete("auth");
    window.history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
    setAuthOpen(false);
    setAuthMode("signup");
  }

  if (entry === "landing") return <ClientLoadBoundary><HomepageLanding start={openAuth}/>{authOpen && <Suspense fallback={<AccountFormLoading close={closeAuth}/>}><AuthPanel initialMode={authMode} close={closeAuth} authenticated={session => void loadWorkspace(session)}/></Suspense>}</ClientLoadBoundary>;
  if (entry === "signup" && complimentaryOffer) return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><ComplimentaryWorkspaceFlow offer={complimentaryOffer} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setComplimentaryOffer(null); setEntry("app"); }}/></AccountMfaGate></Suspense></ClientLoadBoundary>;
  if (entry === "signup") return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><BillingOnboardingGate beforeSetup><SessionTimeout><SecureOnboardingFlow accountName={accountName} accountEmail={accountEmail} signOut={() => void signOut()} complete={(business, owner) => { setOrganizationName(business); setAccountName(owner); setEntry("app"); }}/></SessionTimeout></BillingOnboardingGate></AccountMfaGate></Suspense></ClientLoadBoundary>;
  if (entry === "invitation" && teamInvitation) return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><TeamInvitationFlow invitation={teamInvitation} initialName={accountName} complete={(business, member) => { setOrganizationName(business); setAccountName(member); setTeamInvitation(null); setEntry("app"); }}/></AccountMfaGate></Suspense></ClientLoadBoundary>;
  return <ClientLoadBoundary><Suspense fallback={<AuthenticatedLoading/>}><AccountMfaGate><SessionTimeout><LegalAcceptanceGate><BillingOnboardingGate><VanteloqApp key={workspaceUserId} organizationName={organizationName} accountName={accountName}/></BillingOnboardingGate></LegalAcceptanceGate></SessionTimeout></AccountMfaGate></Suspense></ClientLoadBoundary>;
}

function AccountFormLoading({ close }: { close: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, true, close);
  return <div ref={dialogRef} className="auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-loading-title" tabIndex={-1}>
    <section className="auth-panel">
      <header><ProductBrandLogo product="vanteloq"/><button type="button" onClick={close} aria-label="Close account form">×</button></header>
      <small>SECURE VANTELOQ ACCOUNT</small>
      <h2 id="auth-loading-title">Loading Your Account Form</h2>
      <p role="status">Preparing your secure account form…</p>
    </section>
  </div>;
}

function AuthenticatedLoading() {
  return <main className="workspace-entry-loading"><ProductBrandLogo product="vanteloq" priority/><WorkspaceSkeleton label="Preparing your workspace"/></main>;
}
