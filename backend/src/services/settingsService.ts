/**
 * Integration settings store. Each integration ('smtp', 'connectwise',
 * 'tactical') is one row in the `settings` table (jsonb). Values are seeded
 * from env on first boot and become editable in Admin → Integrations; the DB
 * row wins afterward.
 *
 * Secret fields are write-only: never serialized back to clients (the public
 * view replaces them with `hasX` booleans), and an empty secret on update means
 * "keep the existing value".
 */
import { prisma } from '../db/prisma';
import { config } from '../config/config';

// Keyed rows in the `settings` table. Mostly external-integration config, plus
// 'ui' which holds interface preferences (read by every authed user, not just
// admins — see routes/uiSettings.ts).
export type IntegrationKey =
  | 'smtp'
  | 'connectwise'
  | 'tactical'
  | 'ninjaone'
  | 'datto'
  | 'storage'
  | 'tickets'
  | 'ui';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Validate the relay's TLS cert. False allows an internal Postfix's
   *  self-signed cert (STARTTLS would otherwise fail with ESOCKET). */
  tlsRejectUnauthorized: boolean;
}
export interface ConnectwiseConfig {
  server: string;
  company: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
}
export interface TacticalConfig {
  apiUrl: string;
  apiKey: string;
}
export interface NinjaConfig {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}
export interface DattoConfig {
  apiUrl: string;
  apiKey: string;
  apiSecretKey: string;
}
export interface StorageConfig {
  backend: 'local' | 's3';
  localDir: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
}
export interface TicketsConfig {
  /** Minimum width (zero-padded) for generated ticket numbers, 4–6. */
  numberDigits: number;
}
export interface UiConfig {
  /** Show the legacy DataGrid table view in the ticket view switcher. Off by
   *  default — Board/Cards are the primary views; an admin opts the table in. */
  legacyTableView: boolean;
}

function normalizeTicketDigits(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(6, Math.max(4, Math.trunc(parsed)))
    : config.ticketNumberDigits;
}

// Which fields are secret per integration (omitted from public views).
const SECRET_FIELDS: Record<IntegrationKey, string[]> = {
  smtp: ['pass'],
  connectwise: ['privateKey', 'clientId'],
  tactical: ['apiKey'],
  ninjaone: ['clientSecret'],
  datto: ['apiSecretKey'],
  storage: ['s3SecretAccessKey'],
  tickets: [],
  ui: [],
};

function envDefaults(key: IntegrationKey): Record<string, unknown> {
  switch (key) {
    case 'smtp':
      return { ...config.smtp };
    case 'connectwise':
      return { ...config.cwm };
    case 'tactical':
      return { apiUrl: config.trmm.apiUrl, apiKey: config.trmm.apiKey };
    case 'ninjaone':
      return { ...config.ninja };
    case 'datto':
      return { ...config.datto };
    case 'storage':
      return { ...config.storage };
    case 'tickets':
      return { numberDigits: config.ticketNumberDigits };
    case 'ui':
      return { legacyTableView: false };
  }
}

const cache = new Map<IntegrationKey, Record<string, unknown>>();

async function load(key: IntegrationKey): Promise<Record<string, unknown>> {
  if (cache.has(key)) return cache.get(key)!;
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = (row?.value as Record<string, unknown>) ?? envDefaults(key);
  cache.set(key, value);
  return value;
}

/** Seed any missing integration rows from env (first boot). */
export async function seedSettings(): Promise<void> {
  for (const key of ['smtp', 'connectwise', 'tactical', 'ninjaone', 'datto', 'storage', 'tickets', 'ui'] as IntegrationKey[]) {
    const existing = await prisma.setting.findUnique({ where: { key } });
    if (!existing) {
      await prisma.setting.create({ data: { key, value: envDefaults(key) as object } });
    }
  }
  await applyRuntimeConfig();
}

/**
 * Push DB-backed ConnectWise/Tactical config into the in-memory `config` object
 * so the existing (synchronous) CW/Tactical services pick up Admin edits without
 * an async refactor. SMTP/IMAP read settings directly and don't need this.
 */
export async function applyRuntimeConfig(): Promise<void> {
  const cw = await getConnectwise();
  Object.assign(config.cwm, {
    company: cw.company,
    server: cw.server,
    publicKey: cw.publicKey,
    privateKey: cw.privateKey,
    clientId: cw.clientId,
  });
  const t = await getTactical();
  Object.assign(config.trmm, { apiUrl: t.apiUrl.replace(/\/$/, ''), apiKey: t.apiKey });
  const n = await getNinja();
  Object.assign(config.ninja, {
    apiUrl: n.apiUrl.replace(/\/$/, ''),
    clientId: n.clientId,
    clientSecret: n.clientSecret,
    scope: n.scope,
  });
  const d = await getDatto();
  Object.assign(config.datto, {
    apiUrl: d.apiUrl.replace(/\/$/, ''),
    apiKey: d.apiKey,
    apiSecretKey: d.apiSecretKey,
  });
}

export async function getSmtp(): Promise<SmtpConfig> {
  const v = await load('smtp');
  return {
    host: String(v.host ?? ''),
    port: Number(v.port ?? 587),
    secure: Boolean(v.secure ?? false),
    user: String(v.user ?? ''),
    pass: String(v.pass ?? ''),
    from: String(v.from ?? 'anchordesk@localhost'),
    // Default true (validate). Only an explicit false disables validation, so an
    // older settings row missing the field stays secure.
    tlsRejectUnauthorized: v.tlsRejectUnauthorized !== false,
  };
}

export async function getConnectwise(): Promise<ConnectwiseConfig> {
  const v = await load('connectwise');
  return {
    server: String(v.server ?? ''),
    company: String(v.company ?? ''),
    publicKey: String(v.publicKey ?? ''),
    privateKey: String(v.privateKey ?? ''),
    clientId: String(v.clientId ?? ''),
  };
}

export async function getTactical(): Promise<TacticalConfig> {
  const v = await load('tactical');
  return { apiUrl: String(v.apiUrl ?? ''), apiKey: String(v.apiKey ?? '') };
}

export async function getNinja(): Promise<NinjaConfig> {
  const v = await load('ninjaone');
  return {
    apiUrl: String(v.apiUrl ?? ''),
    clientId: String(v.clientId ?? ''),
    clientSecret: String(v.clientSecret ?? ''),
    scope: String(v.scope ?? 'monitoring management'),
  };
}

export async function getDatto(): Promise<DattoConfig> {
  const v = await load('datto');
  return {
    apiUrl: String(v.apiUrl ?? ''),
    apiKey: String(v.apiKey ?? ''),
    apiSecretKey: String(v.apiSecretKey ?? ''),
  };
}

export async function getStorage(): Promise<StorageConfig> {
  const v = await load('storage');
  const backend = v.backend === 's3' ? 's3' : 'local';
  return {
    backend,
    localDir: String(v.localDir ?? './data/attachments'),
    s3Endpoint: String(v.s3Endpoint ?? ''),
    s3Region: String(v.s3Region ?? 'us-east-1'),
    s3Bucket: String(v.s3Bucket ?? ''),
    s3AccessKeyId: String(v.s3AccessKeyId ?? ''),
    s3SecretAccessKey: String(v.s3SecretAccessKey ?? ''),
    s3ForcePathStyle: Boolean(v.s3ForcePathStyle ?? false),
  };
}

export async function getTickets(): Promise<TicketsConfig> {
  const v = await load('tickets');
  // Clamp to the supported 4–6 range so an out-of-range DB/env value can't
  // produce nonsensical padding.
  return { numberDigits: normalizeTicketDigits(v.numberDigits ?? config.ticketNumberDigits) };
}

export async function getUi(): Promise<UiConfig> {
  const v = await load('ui');
  return { legacyTableView: Boolean(v.legacyTableView ?? false) };
}

/** Merge a partial update; blank secret fields are dropped (keep existing). */
export async function updateSetting(
  key: IntegrationKey,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await load(key);
  const next = { ...current };
  for (const [k, val] of Object.entries(patch)) {
    if (SECRET_FIELDS[key].includes(k) && (val === '' || val == null)) continue; // keep existing secret
    next[k] = key === 'tickets' && k === 'numberDigits' ? normalizeTicketDigits(val) : val;
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: next as object },
    create: { key, value: next as object },
  });
  cache.set(key, next);
  // CW/RMM services read the in-memory config; refresh it on edit.
  if (key === 'connectwise' || key === 'tactical' || key === 'ninjaone' || key === 'datto') {
    await applyRuntimeConfig();
  }
  return next;
}

/** Non-secret view for the Admin UI. Secrets become `hasX: boolean`. */
export function toPublic(key: IntegrationKey, value: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELDS[key].includes(k)) {
      out[`has${k.charAt(0).toUpperCase()}${k.slice(1)}`] = !!v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function getPublic(key: IntegrationKey) {
  return toPublic(key, await load(key));
}

export function resetCache(key?: IntegrationKey) {
  if (key) cache.delete(key);
  else cache.clear();
}
