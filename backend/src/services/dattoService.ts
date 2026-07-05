/**
 * dattoService — thin HTTP client for the Datto RMM API v2.
 *
 * Auth is OAuth2 *password grant* against a fixed public client: we POST to
 * `${apiUrl}/auth/oauth/token` with Basic `public-client:public` and send the
 * API key / secret key as username / password, then cache the bearer (Datto
 * tokens live ~100h). Data endpoints live under `${apiUrl}/api/v2/...`.
 *
 * Scripts are "quick jobs": a component is queued on a device (PUT quickjob) and
 * runs asynchronously — there is no wait mode — so the runner queues and the job
 * status is polled from Datto. componentUid values are copied from the component
 * page in Datto RMM (the API does not expose a component catalogue).
 *
 * Docs: https://rmm.datto.com/help/en/Content/2SETUP/APIv2.htm
 */

import { config } from '../config/config';

const OAUTH_CLIENT = 'public-client';
const OAUTH_SECRET = 'public';

export function isConfigured(): boolean {
  return Boolean(config.datto.apiUrl && config.datto.apiKey && config.datto.apiSecretKey);
}

// ─── OAuth2 token cache ────────────────────────────────────────────────────────

interface TokenState {
  token: string;
  expiresAt: number; // epoch ms, refreshed 60s early
}
let cachedToken: TokenState | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const basic = Buffer.from(`${OAUTH_CLIENT}:${OAUTH_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'password',
    username: config.datto.apiKey,
    password: config.datto.apiSecretKey,
  });

  const res = await fetch(`${config.datto.apiUrl}/auth/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Datto RMM token request failed → ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Datto RMM token response had no access_token');

  const ttlMs = (json.expires_in ?? 360_000) * 1000; // default ~100h
  cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return cachedToken.token;
}

function clearToken(): void {
  cachedToken = null;
}

async function datto<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!isConfigured()) {
    throw new Error('Datto RMM is not configured (set DATTO_API_URL, DATTO_API_KEY, DATTO_API_SECRET_KEY)');
  }

  const token = await getToken();
  const res = await fetch(`${config.datto.apiUrl}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string>),
    },
  });

  if (res.status === 401 && retry) {
    clearToken();
    return datto<T>(path, init, false);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Datto RMM ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
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

/** Raw Datto RMM device (subset we use). */
export interface DattoDevice {
  uid: string;
  hostname?: string;
  description?: string;
  intIpAddress?: string;
  extIpAddress?: string;
  operatingSystem?: string;
  deviceType?: { category?: string; type?: string };
  online?: boolean;
  lastSeen?: number | string;
  siteName?: string;
  systemName?: string;
  [key: string]: unknown;
}

/** The account/devices endpoint is paged: { pageDetails, devices: [...] }. */
interface DattoDevicePage {
  pageDetails?: { count?: number; totalCount?: number; nextPageUrl?: string | null };
  devices?: DattoDevice[];
}

/** Fetch all account devices, following pagination. */
export async function listDevices(): Promise<DattoDevice[]> {
  const all: DattoDevice[] = [];
  let page = 0;
  const max = 200; // hard stop against a runaway loop
  for (let i = 0; i < max; i++) {
    const res = await datto<DattoDevicePage>(`/v2/account/devices?page=${page}&max=250`);
    const batch = res.devices ?? [];
    all.push(...batch);
    if (!res.pageDetails?.nextPageUrl || batch.length === 0) break;
    page += 1;
  }
  return all;
}

export function getDevice(deviceUid: string): Promise<DattoDevice> {
  return datto<DattoDevice>(`/v2/device/${encodeURIComponent(deviceUid)}`);
}

// ─── Quick jobs (script execution) ─────────────────────────────────────────────

export interface QuickJobOptions {
  /** Copied from the component's page in Datto RMM (no API catalogue exists). */
  componentUid: string;
  /** Label shown against the job in Datto RMM. */
  jobName?: string;
  /** Component input variables, name → value. */
  variables?: Record<string, string>;
}

export interface DattoJob {
  uid?: string;
  status?: string; // e.g. 'active' | 'completed' | 'failed'
  [key: string]: unknown;
}

/** Queue a quick job (component run) on a device. Returns the created job uid. */
export async function createQuickJob(deviceUid: string, opts: QuickJobOptions): Promise<string> {
  const res = await datto<{ job?: DattoJob; uid?: string }>(
    `/v2/device/${encodeURIComponent(deviceUid)}/quickjob`,
    {
      method: 'PUT',
      body: JSON.stringify({
        jobName: opts.jobName ?? 'AnchorDesk Quick Job',
        jobComponent: {
          componentUid: opts.componentUid,
          variables: opts.variables ?? {},
        },
      }),
    }
  );
  const uid = res.job?.uid ?? res.uid;
  if (!uid) throw new Error('Datto RMM quick job response had no job uid');
  return uid;
}

export function getJob(jobUid: string): Promise<DattoJob> {
  return datto<DattoJob>(`/v2/job/${encodeURIComponent(jobUid)}`);
}
