import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { useEffect, useSyncExternalStore } from 'react';

import { identifyPurchaser } from '../payments';
import { supabase, supabaseConfigured } from './supabase';

/** The signed-in person, as the app shows it. `provider`: how they signed in ("apple", "google"). */
export type Account = { id: string; email: string | null; name: string | null; provider: string };
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

function toAccount(session: Session | null): Account | null {
  if (session === null) return null;
  const user = session.user;
  const meta = user.user_metadata || {};
  const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
  const provider = typeof user.app_metadata.provider === 'string' ? user.app_metadata.provider : 'unknown';
  return { id: user.id, email: user.email || null, name, provider };
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
    const next = toAccount(session);
    const before = state.account === null ? null : state.account.id;
    publish({ ready: true, account: next });
    const after = next === null ? null : next.id;
    if (before !== after) void identifyPurchaser(after);
  });
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
  const { error } = await supabase().auth.signInWithIdToken({ provider: 'google', token });
  if (error) throw error;
  return 'signedIn';
}

/** Signs out here (the account and its links stay on the server). */
export async function signOut(): Promise<void> {
  const provider = state.account === null ? null : state.account.provider;
  const { error } = await supabase().auth.signOut();
  if (error) throw error;
  if (provider === 'google') {
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
  const provider = state.account === null ? null : state.account.provider;
  const body: { appleCode?: string; appleClientId?: string } = {};
  if (provider === 'apple') {
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
  if (provider === 'google' && google.iosClientId && google.webClientId) {
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
  return 'deleted';
}
