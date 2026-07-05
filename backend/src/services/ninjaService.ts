/**
 * ninjaService — thin HTTP client for the NinjaOne (NinjaRMM) Public API v2.
 *
 * Auth is OAuth2 client-credentials: we POST clientId/clientSecret to
 * `${apiUrl}/ws/oauth/token` and cache the bearer until it expires. Everything
 * else in the app talks to NinjaOne only through NinjaOneProvider / NinjaOneRunner,
 * which call this module. Mirrors tacticalService's shape, plus token handling.
 *
 * Docs: https://app.ninjarmm.com/apidocs/  (regional hosts: app/eu/oc/ca.ninjarmm.com)
 */

import { config } from '../config/config';

export function isConfigured(): boolean {
  return Boolean(config.ninja.apiUrl && config.ninja.clientId && config.ninja.clientSecret);
}

// ─── OAuth2 token cache ────────────────────────────────────────────────────────

interface TokenState {
  token: string;
  /** epoch ms at which we should stop trusting the token (refreshed 60s early). */
  expiresAt: number;
}
let cachedToken: TokenState | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.ninja.clientId,
    client_secret: config.ninja.clientSecret,
    scope: config.ninja.scope,
  });

  const res = await fetch(`${config.ninja.apiUrl}/ws/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`NinjaOne token request failed → ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('NinjaOne token response had no access_token');

  const ttlMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return cachedToken.token;
}

/** Force the next request to re-authenticate (used on a 401). */
function clearToken(): void {
  cachedToken = null;
}

async function ninja<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!isConfigured()) {
    throw new Error('NinjaOne is not configured (set NINJA_API_URL, NINJA_CLIENT_ID, NINJA_CLIENT_SECRET)');
  }

  const token = await getToken();
  const res = await fetch(`${config.ninja.apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  });

  // A stale cached token → clear and retry once with a fresh one.
  if (res.status === 401 && retry) {
    clearToken();
    return ninja<T>(path, init, false);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NinjaOne ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

// ─── Device shapes ─────────────────────────────────────────────────────────────

/** Raw NinjaOne device (from /v2/devices-detailed; subset we use). */
export interface NinjaDevice {
  id: number;
  organizationId?: number;
  systemName?: string;
  dnsName?: string;
  displayName?: string;
  nodeClass?: string; // WINDOWS_SERVER | WINDOWS_WORKSTATION | MAC | LINUX_* ...
  offline?: boolean;
  lastContact?: number; // epoch seconds
  ipAddresses?: string[];
  publicIP?: string;
  system?: { manufacturer?: string; model?: string; serialNumber?: string };
  os?: { name?: string; architecture?: string };
  [key: string]: unknown;
}

export interface NinjaOrganization {
  id: number;
  name?: string;
  [key: string]: unknown;
}

export interface NinjaScript {
  id: number;
  name: string;
  language?: string; // powershell | batch | shell ...
  [key: string]: unknown;
}

/** List all devices with the detailed projection (includes os/ip/lastContact). */
export function listDevices(): Promise<NinjaDevice[]> {
  return ninja<NinjaDevice[]>('/v2/devices-detailed');
}

export function getDevice(deviceId: string): Promise<NinjaDevice> {
  return ninja<NinjaDevice>(`/v2/device/${encodeURIComponent(deviceId)}`);
}

export function listOrganizations(): Promise<NinjaOrganization[]> {
  return ninja<NinjaOrganization[]>('/v2/organizations');
}

export function listScripts(): Promise<NinjaScript[]> {
  return ninja<NinjaScript[]>('/v2/automation/scripts');
}

export interface RunScriptOptions {
  scriptId: number;
  /** Space-joined argument string NinjaOne passes to the script. */
  parameters?: string;
  runAs?: string; // 'system' | 'loggedonuser' | ...
}

/**
 * Run a saved automation script on a device. NinjaOne queues the run and returns
 * immediately (there is no synchronous wait mode), so the caller records the job
 * and the output shows up in NinjaOne itself. We surface the acknowledgement.
 */
export async function runScript(deviceId: string, opts: RunScriptOptions): Promise<string> {
  const result = await ninja<unknown>(`/v2/device/${encodeURIComponent(deviceId)}/script/run`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'SCRIPT',
      id: opts.scriptId,
      parameters: opts.parameters ?? '',
      runAs: opts.runAs ?? 'system',
    }),
  });
  return typeof result === 'string' ? result : JSON.stringify(result ?? { queued: true });
}
