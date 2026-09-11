/**
 * AuthGate — nothing mounts before a signed-in user (D3).
 *
 * With Firebase configured (VITE_FIREBASE_*), the terminal is a sign-in screen
 * until Google says who this is; the backend then decides whether that uid is
 * allowed. Three honest states, rendered differently on purpose:
 *   checking    the SDK has not said yet — a line, not a blank page
 *   signed out  the sign-in button and, if the popup failed, its sentence
 *   refused     signed in but not allowed (403 UID_NOT_ALLOWED from any
 *               request): the server's sentence, verbatim, and a sign-out —
 *               never an empty board that looks like a quiet market
 * Without Firebase configured (a dev build against a loopback backend) the
 * gate is transparent.
 */
import React, { useEffect, useState } from "react";
import { configured, onUser, signIn, signOut, type AuthUser } from "../auth";
import { AUTH_REFUSED_EVENT } from "../api/client";

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null | undefined>(configured ? undefined : null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const off = onUser((u) => { setUser(u); if (!u) setRefused(null); });
    const onRefused = (e: Event) => setRefused((e as CustomEvent<{ message: string }>).detail?.message || "this account is not allowed on the terminal");
    window.addEventListener(AUTH_REFUSED_EVENT, onRefused);
    return () => { off(); window.removeEventListener(AUTH_REFUSED_EVENT, onRefused); };
  }, []);

  if (!configured) return <>{children}</>;

  const doSignIn = async () => {
    setBusy(true); setError(null);
    try { await signIn(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (user === undefined) {
    return <div className="auth-gate" id="auth-gate" data-state="checking"><p className="auth-line">checking sign-in…</p></div>;
  }
  if (user === null) {
    return (
      <div className="auth-gate" id="auth-gate" data-state="signed-out">
        <div className="auth-card">
          <div className="auth-title">SPREAD</div>
          <p className="auth-line">This terminal is for its operator. Sign in with the Google account listed on the backend.</p>
          <button type="button" className="auth-btn" id="auth-signin" onClick={doSignIn} disabled={busy}>{busy ? "opening Google…" : "Sign in with Google"}</button>
          {error && <p className="auth-err" id="auth-error">sign-in failed: {error}</p>}
        </div>
      </div>
    );
  }
  if (refused) {
    return (
      <div className="auth-gate" id="auth-gate" data-state="refused">
        <div className="auth-card">
          <div className="auth-title">NOT ALLOWED</div>
          <p className="auth-err" id="auth-refused">{refused}</p>
          <p className="auth-line">Signed in as {user.email || user.uid}. The backend's SPREAD_ALLOWED_UIDS decides who may use the terminal.</p>
          <button type="button" className="auth-btn" id="auth-signout" onClick={() => signOut()}>Sign out</button>
        </div>
      </div>
    );
  }
  return (
    <>
      {children}
      <div className="auth-who" id="auth-who">
        <span>{user.email || user.uid}</span>
        <button type="button" className="auth-link" id="auth-signout-small" onClick={() => signOut()}>sign out</button>
      </div>
    </>
  );
};
