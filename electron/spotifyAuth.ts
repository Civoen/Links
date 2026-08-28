import { app, shell, BrowserWindow, safeStorage } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { REDIRECT_URI, SCOPES } from "./config";
import { getClientId } from "./settings";

interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
}

const TOKEN_PATH = () => path.join(app.getPath("userData"), "spotify-tokens.json");

let pendingVerifier: string | null = null;
let pendingState: string | null = null;
let pendingResolve: ((tokens: TokenSet) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Tokens are encrypted at rest using Electron's safeStorage, which is
 * backed by the OS's own credential store (Keychain on macOS, DPAPI on
 * Windows, a keyring on Linux where available). Falls back to plaintext
 * only if the OS genuinely doesn't offer encryption on this machine —
 * some minimal Linux setups without a keyring daemon — rather than
 * refusing to store tokens at all. Also transparently migrates a token
 * file written before this encryption existed, so upgrading doesn't sign
 * anyone out.
 */
export function loadTokens(): TokenSet | null {
  let raw: Buffer;
  try {
    raw = fs.readFileSync(TOKEN_PATH());
  } catch {
    return null;
  }

  if (safeStorage.isEncryptionAvailable()) {
    try {
      return JSON.parse(safeStorage.decryptString(raw)) as TokenSet;
    } catch {
      // Not encrypted-format data — likely a plaintext file from before
      // this encryption existed. Fall through to the plaintext attempt
      // below rather than treating this as "no tokens".
    }
  }

  try {
    return JSON.parse(raw.toString("utf-8")) as TokenSet;
  } catch {
    return null;
  }
}

function saveTokens(tokens: TokenSet) {
  const json = JSON.stringify(tokens, null, 2);

  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(TOKEN_PATH(), safeStorage.encryptString(json));
  } else {
    console.warn("[spotifyAuth] OS-level encryption unavailable — storing tokens in plaintext.");
    fs.writeFileSync(TOKEN_PATH(), json, "utf-8");
  }
}

export function isConnected(): boolean {
  return loadTokens() !== null;
}

export function disconnect() {
  try {
    fs.unlinkSync(TOKEN_PATH());
  } catch {
    // nothing to remove
  }
}

/**
 * Opens the system browser to Spotify's authorize screen and resolves once
 * the OS hands the "links://callback?code=..." redirect back to us via the
 * registered protocol handler (wired up in main.ts).
 */
export function startAuth(): Promise<TokenSet> {
  const clientId = getClientId();
  if (!clientId) {
    return Promise.reject(new Error("No Spotify Client ID has been set yet"));
  }

  const { verifier, challenge } = generatePkcePair();
  pendingVerifier = verifier;

  // PKCE protects against the authorization code being intercepted in
  // transit, but doesn't by itself confirm a given callback actually
  // corresponds to the auth request this app just started — that's what
  // the state parameter is for. Generated fresh per attempt and checked
  // against the value the callback comes back with, so a callback that
  // doesn't match a currently in-progress request from this app is
  // rejected outright rather than acted on.
  pendingState = base64url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state: pendingState
  });

  shell.openExternal(`https://accounts.spotify.com/authorize?${params.toString()}`);

  return new Promise((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
  });
}

/** Called by main.ts when the links://callback URL comes in. */
export async function handleAuthCallback(url: string) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    const error = parsed.searchParams.get("error");
    const state = parsed.searchParams.get("state");

    if (!pendingState || state !== pendingState) {
      // Doesn't match a currently in-progress request this app actually
      // started — could be a stray/replayed callback, or malformed input
      // from somewhere else entirely. Reject rather than proceed with a
      // token exchange for it.
      throw new Error("Auth callback did not match the request that was started");
    }

    if (error || !code || !pendingVerifier) {
      throw new Error(error || "Missing authorization code");
    }

    const tokens = await exchangeCodeForTokens(code, pendingVerifier);
    saveTokens(tokens);
    pendingResolve?.(tokens);
  } catch (err) {
    pendingReject?.(err as Error);
  } finally {
    pendingVerifier = null;
    pendingState = null;
    pendingResolve = null;
    pendingReject = null;
  }
}

async function exchangeCodeForTokens(code: string, verifier: string): Promise<TokenSet> {
  const clientId = getClientId();
  if (!clientId) throw new Error("No Spotify Client ID has been set yet");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000
  };
}

async function refreshTokens(refresh_token: string): Promise<TokenSet> {
  const clientId = getClientId();
  if (!clientId) throw new Error("No Spotify Client ID has been set yet");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: clientId
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return {
    access_token: json.access_token,
    // Spotify doesn't always return a new refresh_token — keep the old one if so.
    refresh_token: json.refresh_token || refresh_token,
    expires_at: Date.now() + json.expires_in * 1000
  };
}

/** Returns a valid access token, refreshing first if it's expired or close to it. */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = loadTokens();
  if (!tokens) return null;

  const isExpiringSoon = Date.now() > tokens.expires_at - 60_000;
  if (!isExpiringSoon) return tokens.access_token;

  const refreshed = await refreshTokens(tokens.refresh_token);
  saveTokens(refreshed);
  return refreshed.access_token;
}
