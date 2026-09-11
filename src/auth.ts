/**
 * src/auth.ts — the terminal signs in (D3).
 *
 * The API and the socket used to carry a static bearer compiled into this
 * public bundle. Now the SPA signs in with Firebase Auth (Google) and every
 * request carries the user's ID token; the backend verifies it with the Admin
 * SDK and allows the uid. The bundle carries NO secret: the Firebase web config
 * (apiKey, authDomain, projectId) is public by design and unlocks nothing
 * without a signed-in, allowlisted user.
 *
 * Loaded lazily (dynamic import of firebase/auth), so a test that mocks this
 * module never pulls the SDK, and a dev build without VITE_FIREBASE_* runs
 * against a loopback backend with no sign-in at all (`configured` false).
 */
export interface AuthUser { uid: string; email: string | null; }

const env = import.meta.env;
export const firebaseConfig = {
  apiKey: (env.VITE_FIREBASE_API_KEY as string | undefined)?.trim() || "",
  authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim() || "",
  projectId: (env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim() || "",
};
/** True when the build was given a Firebase project: sign-in is required. */
export const configured: boolean = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId);

type FbAuth = import("firebase/auth").Auth;
let authP: Promise<FbAuth> | null = null;
async function auth(): Promise<FbAuth> {
  if (!authP) {
    authP = (async () => {
      const { initializeApp, getApps, getApp } = await import("firebase/app");
      const { getAuth, browserLocalPersistence, setPersistence } = await import("firebase/auth");
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const a = getAuth(app);
      await setPersistence(a, browserLocalPersistence);
      return a;
    })();
  }
  return authP;
}

/** Subscribe to the signed-in user. `undefined` = not yet known, `null` = signed out. */
export function onUser(cb: (u: AuthUser | null) => void): () => void {
  if (!configured) { cb(null); return () => {}; }
  let off: (() => void) | null = null, gone = false;
  auth().then(async (a) => {
    const { onAuthStateChanged } = await import("firebase/auth");
    if (gone) return;
    off = onAuthStateChanged(a, (u) => cb(u ? { uid: u.uid, email: u.email } : null));
  });
  return () => { gone = true; off?.(); };
}

/** Google sign-in, in a popup (firebase.json already sets COOP same-origin-allow-popups). */
export async function signIn(): Promise<AuthUser> {
  const a = await auth();
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const r = await signInWithPopup(a, new GoogleAuthProvider());
  return { uid: r.user.uid, email: r.user.email };
}

export async function signOut(): Promise<void> {
  if (!configured) return;
  const a = await auth();
  const { signOut: so } = await import("firebase/auth");
  await so(a);
}

/**
 * The current user's ID token — the SDK refreshes it before expiry; `force`
 * asks for a fresh one now (after a TOKEN_EXPIRED from the server). null when
 * sign-in is not configured or nobody is signed in: the request then carries
 * no Authorization and the server says so.
 */
export async function idToken(force = false): Promise<string | null> {
  if (!configured) return null;
  const a = await auth();
  const u = a.currentUser ?? await new Promise<import("firebase/auth").User | null>((resolve) => {
    // first call before onAuthStateChanged has settled: wait for it once
    import("firebase/auth").then(({ onAuthStateChanged }) => {
      const off = onAuthStateChanged(a, (x) => { off(); resolve(x); });
    });
  });
  if (!u) return null;
  return u.getIdToken(force);
}
