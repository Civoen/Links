import { app, shell, BrowserWindow } from "electron";
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

export function loadTokens(): TokenSet | null {
  try {
    const raw = fs.readFileSync(TOKEN_PATH(), "utf-8");
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

function saveTokens(tokens: TokenSet) {
  // NOTE: for a real release build, wrap this in Electron's `safeStorage`
  // API so tokens are encrypted at rest rather than sitting in plaintext
  // in userData. Left plain here to keep the MVP easy to read and debug.
  fs.writeFileSync(TOKEN_PATH(), JSON.stringify(tokens, null, 2), "utf-8");
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

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES
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
