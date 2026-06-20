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

export type IntegrationKey = 'smtp' | 'connectwise' | 'tactical';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
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

// Which fields are secret per integration (omitted from public views).
const SECRET_FIELDS: Record<IntegrationKey, string[]> = {
  smtp: ['pass'],
  connectwise: ['privateKey', 'clientId'],
  tactical: ['apiKey'],
};

function envDefaults(key: IntegrationKey): Record<string, unknown> {
  switch (key) {
    case 'smtp':
      return { ...config.smtp };
    case 'connectwise':
      return { ...config.cwm };
    case 'tactical':
      return { apiUrl: config.trmm.apiUrl, apiKey: config.trmm.apiKey };
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
  for (const key of ['smtp', 'connectwise', 'tactical'] as IntegrationKey[]) {
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

/** Merge a partial update; blank secret fields are dropped (keep existing). */
export async function updateSetting(
  key: IntegrationKey,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const current = await load(key);
  const next = { ...current };
  for (const [k, val] of Object.entries(patch)) {
    if (SECRET_FIELDS[key].includes(k) && (val === '' || val == null)) continue; // keep existing secret
    next[k] = val;
  }
  await prisma.setting.upsert({
    where: { key },
    update: { value: next as object },
    create: { key, value: next as object },
  });
  cache.set(key, next);
  // CW/Tactical services read the in-memory config; refresh it on edit.
  if (key === 'connectwise' || key === 'tactical') await applyRuntimeConfig();
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
