import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import type { User } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { useEffect, useSyncExternalStore } from 'react';

import { kv } from '../data/mmkv';
import { diag } from '../diag/diagLog';
import { identifyPurchaser } from '../payments';
import { supabase, supabaseConfigured } from './supabase';

/**
 * The signed-in person, as the app shows it. `provider`: how they signed in this time ("apple", "google");
 * `providers`: every sign-in joined to the account (Supabase joins an Apple and a Google sign-in with the same email).
 */
export type Account = { id: string; email: string | null; name: string | null; provider: string; providers: string[] };
/** `ready`: the saved session has been read (before that, "signed out" may not be true yet). */
export type AccountState = { ready: boolean; account: Account | null };
/** How a sign-in attempt ended. Errors other than a cancel are thrown. */
export type SignInResult = 'signedIn' | 'cancelled';
/** How an account deletion ended. Errors other than a cancel are thrown. */
export type DeleteResult = 'deleted' | 'cancelled';

const extra = (Constants.expoConfig && Constants.expoConfig.extra) || {};
const google: { iosClientId?: string; webClientId?: string } = extra.google || {};

let state: AccountState = { ready: false, account: null };
const listeners = new Set<() => void>();
let started = false;

function publish(next: AccountState): void {
  state = next;
  listeners.forEach((fn) => fn());
}

/**
 * The sign-in last used on this phone. Supabase does not say which identity opened a session (app_metadata.provider is
 * the first sign-in ever, and identities[].last_sign_in_at is not kept up to date for native sign-ins), so the app
 * remembers which button was used.
 */
const SIGNED_IN_WITH = 'account.signedInWith';

function signedInWith(): string | undefined {
  try {
    return kv.getString(SIGNED_IN_WITH);
  } catch {
    return undefined;
  }
}

function rememberSignIn(provider: string | undefined): void {
  try {
    if (provider === undefined) kv.delete(SIGNED_IN_WITH);
    else kv.set(SIGNED_IN_WITH, provider);
  } catch {
    // Only the label on the account screen depends on it.
  }
}

function toAccount(user: User | null): Account | null {
  if (user === null) return null;
  const meta = user.user_metadata || {};
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
  // app_metadata.provider is the first sign-in ever: the latest identity says how this session was opened.
  const identities = (user.identities || []).slice().sort((a, b) => Date.parse(b.last_sign_in_at || '') - Date.parse(a.last_sign_in_at || ''));
  const first = typeof user.app_metadata.provider === 'string' ? user.app_metadata.provider : 'unknown';
  const providers = identities.length > 0 ? identities.map((i) => i.provider) : [first];
  const used = signedInWith();
  const provider = used !== undefined && providers.includes(used) ? used : identities.length > 0 ? identities[0].provider : first;
  return { id: user.id, email: user.email || null, name, provider, providers };
}

/** Reads the saved session and follows every change; RevenueCat follows the account. Safe to call many times. */
export function startAccount(): void {
  if (started) return;
  started = true;
  if (!supabaseConfigured()) {
    publish({ ready: true, account: null });
    return;
  }
  // INITIAL_SESSION arrives first with the saved session (or none). No Supabase call inside this callback: the SDK
  // holds a lock while it runs.
  supabase().auth.onAuthStateChange((_event, session) => {
    const next = toAccount(session === null ? null : session.user);
    const before = state.account === null ? null : state.account.id;
    publish({ ready: true, account: next });
    const after = next === null ? null : next.id;
    if (before !== after) void identifyPurchaser(after);
    if (next !== null && before !== after) setTimeout(() => void checkUser(), 0);
  });
}

/**
 * The saved session holds a copy of the user from the last sign-in or refresh. Asked once per account, the server says
 * whether it still exists (an account deleted elsewhere leaves a session the server no longer accepts) and gives the
 * current sign-ins joined to it. Without a network nothing changes.
 */
async function checkUser(): Promise<void> {
  const { data, error } = await supabase().auth.getUser();
  if (error) {
    const status = typeof error.status === 'number' ? error.status : 0;
    diag(`conta: conferir login FALHOU (${status === 0 ? error.message : `HTTP ${status}`})`);
    if (status === 401 || status === 403 || status === 404) await supabase().auth.signOut({ scope: 'local' });
    return;
  }
  if (data.user && state.account !== null && data.user.id === state.account.id) publish({ ready: true, account: toAccount(data.user) });
}

/**
 * After the server refused the session (401): a fresh access token is tried once. True when it worked; false when the
 * session is gone for good, and then this phone signs out so the person can sign in again.
 */
export async function refreshOrSignOut(): Promise<boolean> {
  const { error } = await supabase().auth.refreshSession();
  if (!error) return true;
  diag(`conta: renovar login FALHOU (${error.message})`);
  await supabase().auth.signOut({ scope: 'local' });
  return false;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The account as it stands, kept up to date. */
export function useAccount(): AccountState {
  useEffect(() => startAccount(), []);
  return useSyncExternalStore(subscribe, () => state);
}

/**
 * Sign in with Apple, native sheet. The nonce goes hashed to Apple and raw to Supabase, which checks they match.
 * Apple gives the name only on the first sign-in: it is saved then as the display name.
 */
export async function signInWithApple(): Promise<SignInResult> {
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashed,
    });
  } catch (e) {
    if (isAppleCancel(e)) return 'cancelled';
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  rememberSignIn('apple');
  const { data, error } = await supabase().auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;
  const fullName = credential.fullName ? AppleAuthentication.formatFullName(credential.fullName) : '';
  if (fullName && data.user) {
    await supabase().from('profiles').update({ display_name: fullName.slice(0, 60) }).eq('id', data.user.id);
  }
  return 'signedIn';
}

/** Sign in with Google, native sheet. The ID token is checked by Supabase against the web and iOS client ids. */
export async function signInWithGoogle(): Promise<SignInResult> {
  if (!google.iosClientId || !google.webClientId) throw new Error('Google sign-in is not configured in this build');
  GoogleSignin.configure({ iosClientId: google.iosClientId, webClientId: google.webClientId });
  let token: string | null;
  try {
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return 'cancelled';
    token = response.data.idToken;
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as { code: string }).code === statusCodes.SIGN_IN_CANCELLED) return 'cancelled';
    throw e;
  }
  if (!token) throw new Error('Google returned no ID token');
  rememberSignIn('google');
  const { error } = await supabase().auth.signInWithIdToken({ provider: 'google', token });
  if (error) throw error;
  return 'signedIn';
}

/**
 * Signs out on this phone only (the account and its links stay on the server). The SDK's default scope is global: it
 * would end the sessions of every other phone signed in to the same account, which then look signed in but are refused.
 */
export async function signOut(): Promise<void> {
  const providers = state.account === null ? [] : state.account.providers;
  const { error } = await supabase().auth.signOut({ scope: 'local' });
  if (error) throw error;
  rememberSignIn(undefined);
  if (providers.includes('google')) {
    try {
      await GoogleSignin.signOut();
    } catch {
      // Google's own session is only a convenience for the next sign-in.
    }
  }
}

function isAppleCancel(e: unknown): boolean {
  return e instanceof Error && 'code' in e && (e as { code: string }).code === 'ERR_REQUEST_CANCELED';
}

/**
 * Deletes the account on the server and signs out here. Apple accounts confirm with Apple first: the fresh
 * authorization code lets the server revoke Reprize at Apple. The recordings on this phone are not touched.
 */
export async function deleteAccount(): Promise<DeleteResult> {
  const providers = state.account === null ? [] : state.account.providers;
  const body: { appleCode?: string; appleClientId?: string } = {};
  // An account with an Apple sign-in joined to it is revoked at Apple, whichever sign-in opened this session.
  if (providers.includes('apple')) {
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    } catch (e) {
      if (isAppleCancel(e)) return 'cancelled';
      throw e;
    }
    if (!credential.authorizationCode) throw new Error('Apple returned no authorization code');
    body.appleCode = credential.authorizationCode;
    body.appleClientId = Application.applicationId || '';
  }
  const { error } = await supabase().functions.invoke('delete-account', { body });
  if (error) throw error;
  if (providers.includes('google') && google.iosClientId && google.webClientId) {
    try {
      GoogleSignin.configure({ iosClientId: google.iosClientId, webClientId: google.webClientId });
      if (GoogleSignin.hasPreviousSignIn()) {
        await GoogleSignin.signInSilently();
        await GoogleSignin.revokeAccess();
      }
    } catch {
      // Revoking at Google only removes Reprize from the person's Google account page; the account is already gone.
    }
  }
  // The user no longer exists on the server: clear the session on this phone only.
  await supabase().auth.signOut({ scope: 'local' });
  rememberSignIn(undefined);
  return 'deleted';
}
