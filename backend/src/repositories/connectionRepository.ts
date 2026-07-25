/**
 * connectionRepository — CRUD for external account credentials.
 *
 * A Connection is one Jira site or one ConnectWise instance. Credentials used to
 * live in a single `settings` row per provider type, which capped AnchorDesk at
 * one account of each kind per install; a sync job now points at a connection,
 * so an MSP can sync several clients' tenants from one install.
 *
 * Secrets never leave here in readable form. `toPublic()` is the only shape the
 * API layer is allowed to serialize, mirroring how auth settings are handled.
 */

import { Prisma, ProviderType } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as auditRepo from './auditRepository';
import {
  SyncAccountBusyError,
  withSyncAccountLock,
} from '../services/syncAccountLock';

/** Credential fields that must never be serialized outbound, per provider type. */
const SECRET_FIELDS: Partial<Record<ProviderType, string[]>> = {
  jira: ['apiToken'],
  connectwise: ['privateKey', 'clientId'],
};

/** Which config keys each provider type accepts. Unknown keys are rejected so a
 *  typo cannot silently produce a connection that can never authenticate. */
const ALLOWED_FIELDS: Partial<Record<ProviderType, string[]>> = {
  jira: ['baseUrl', 'email', 'apiToken'],
  connectwise: ['server', 'company', 'publicKey', 'privateKey', 'clientId'],
};

/**
 * Types that can be managed as connections today.
 *
 * ConnectWise is deliberately excluded: `ConnectWiseProvider` still talks to a
 * process-global client, so a per-tenant CW connection would record provenance
 * that never controlled the request — worse than the honest singleton. It joins
 * this list when the CW client is de-singletoned.
 */
export const SUPPORTED_CONNECTION_TYPES = ['jira'] as const;
export type ConnectionType = (typeof SUPPORTED_CONNECTION_TYPES)[number];

export class ConnectionValidationError extends Error {}
export class ConnectionIdentityConflictError extends ConnectionValidationError {}
export class ConnectionBusyError extends ConnectionValidationError {}
export class ConnectionTestStaleError extends ConnectionValidationError {}

function normalizedBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().replace(/\/+$/, '');
}

export interface ConnectionRow {
  id: number;
  name: string;
  type: ProviderType;
  config: Prisma.JsonValue;
  enabled: boolean;
  configRevision: number;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

/** Non-secret view. Secrets collapse to `hasApiToken: true` style flags. */
export function toPublic(row: ConnectionRow) {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const secrets = SECRET_FIELDS[row.type] ?? [];
  const allowed = ALLOWED_FIELDS[row.type] ?? [];
  const out: Record<string, unknown> = {};

  for (const key of allowed) {
    const value = cfg[key];
    if (secrets.includes(key)) {
      out[`has${key.charAt(0).toUpperCase()}${key.slice(1)}`] =
        typeof value === 'string' && value.trim().length > 0;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    config: out,
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastTestMessage: row.lastTestMessage,
    // "Configured" must mean every required field is present, secrets included.
    // The old Admin card called Jira configured with a site URL and an email and
    // no API token at all, which is exactly how a broken setup looked healthy.
    configured: isConfigured(row.type, cfg),
  };
}

/** Every credential field required to actually authenticate is present. */
export function isConfigured(type: ProviderType, cfg: Record<string, unknown>): boolean {
  const required = ALLOWED_FIELDS[type] ?? [];
  return (
    required.length > 0 &&
    required.every((field) => typeof cfg[field] === 'string' && cfg[field].trim().length > 0)
  );
}

/** Validate + normalize a config patch. Blank secrets mean "keep existing". */
export function mergeConfig(
  type: ProviderType,
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const allowed = ALLOWED_FIELDS[type];
  if (!allowed) throw new ConnectionValidationError(`unsupported connection type "${type}"`);

  const secrets = SECRET_FIELDS[type] ?? [];
  // Rebuild from the provider's current vocabulary rather than carrying raw
  // stored JSON forward. This self-heals legacy or hand-edited rows and makes
  // the write path obey the same allowlist as the public DTO.
  const next: Record<string, unknown> = {};
  for (const key of allowed) {
    if (typeof existing[key] === 'string') next[key] = existing[key];
  }

  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) {
      throw new ConnectionValidationError(`unknown field "${k}" (allowed: ${allowed.join(', ')})`);
    }
    // A blank secret is the UI echoing back "unchanged", not a request to clear.
    if (secrets.includes(k) && (v === '' || v == null)) continue;
    if (typeof v !== 'string') {
      throw new ConnectionValidationError(`config.${k} must be a string`);
    }
    next[k] = v.trim();
  }

  // Normalize the URL shapes the clients concatenate onto.
  if (typeof next.baseUrl === 'string') next.baseUrl = next.baseUrl.replace(/\/+$/, '');
  if (typeof next.server === 'string') next.server = next.server.replace(/\/+$/, '');

  return next;
}

export async function list(type?: ProviderType) {
  return prisma.connection.findMany({
    where: type ? { type } : undefined,
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });
}

export async function getById(id: number) {
  return prisma.connection.findUnique({ where: { id } });
}

export async function create(
  input: { name: string; type: ProviderType; config?: Record<string, unknown>; enabled?: boolean },
  actor: string
) {
  const config = mergeConfig(input.type, {}, input.config ?? {});
  // Mutation and audit row commit together — a mutation that lands without an
  // audit trail would violate "full audit log on every mutation."
  return prisma.$transaction(async (tx) => {
    const row = await tx.connection.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        config: config as Prisma.InputJsonValue,
        enabled: input.enabled ?? true,
      },
    });
    await auditRepo.record(
      {
        entityType: 'connection',
        entityId: row.id,
        action: 'create',
        changedBy: actor,
        newValue: { name: row.name, type: row.type, configured: isConfigured(row.type, config) },
      },
      tx
    );
    return row;
  });
}

export async function update(
  id: number,
  patch: { name?: string; config?: Record<string, unknown>; enabled?: boolean },
  actor: string
) {
  try {
    return await withSyncAccountLock(`jira:connection:${id}`, () =>
      prisma.$transaction(async (tx) => {
        // Read after locking, inside the transaction. Two concurrent credential
        // patches must merge from the first patch's committed value rather than
        // both restoring pieces of the same stale pre-transaction JSON.
        const locked = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM connections WHERE id = ${id} FOR UPDATE
        `;
        if (locked.length === 0) return null;
        const existing = await tx.connection.findUniqueOrThrow({ where: { id } });

        const data: Prisma.ConnectionUpdateInput = {};
        let credentialsChanged = false;
        if (patch.name !== undefined) data.name = patch.name.trim();
        if (patch.enabled !== undefined) data.enabled = patch.enabled;
        if (patch.config !== undefined) {
          const existingConfig = (existing.config ?? {}) as Record<string, unknown>;
          const nextConfig = mergeConfig(existing.type, existingConfig, patch.config);

          if (
            existing.type === 'jira' &&
            Object.prototype.hasOwnProperty.call(patch.config, 'baseUrl') &&
            normalizedBaseUrl(nextConfig.baseUrl) !== normalizedBaseUrl(existingConfig.baseUrl)
          ) {
            throw new ConnectionIdentityConflictError(
              'Jira site URL cannot be changed after the connection is created; create a new connection for a different Jira tenant'
            );
          }

          data.config = nextConfig as Prisma.InputJsonValue;
          credentialsChanged = (ALLOWED_FIELDS[existing.type] ?? []).some(
            (field) => existingConfig[field] !== nextConfig[field]
          );
          if (credentialsChanged) {
            data.configRevision = { increment: 1 };
            data.lastTestAt = null;
            data.lastTestOk = null;
            data.lastTestMessage = null;
          }
        }

        const operationalChange =
          credentialsChanged ||
          (patch.enabled !== undefined && patch.enabled !== existing.enabled);
        if (operationalChange) {
          const linkedJobs = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT id
            FROM sync_providers
            WHERE connection_id = ${id}
            ORDER BY id
            FOR UPDATE
          `;
          if (linkedJobs.length > 0) {
            const running = await tx.syncRun.count({
              where: {
                providerId: { in: linkedJobs.map((job) => job.id) },
                status: 'running',
              },
            });
            if (running > 0) {
              throw new ConnectionBusyError(
                'wait for the active sync run to finish before changing this connection'
              );
            }
          }
        }

        const row = await tx.connection.update({ where: { id }, data });
        let linkedJobsReset = 0;
        if (credentialsChanged) {
          const reset = await tx.syncProvider.updateMany({
            where: { connectionId: id },
            data: {
              lastSyncedAt: null,
              configRevision: { increment: 1 },
            },
          });
          linkedJobsReset = reset.count;
        }
        await auditRepo.record(
          {
            entityType: 'connection',
            entityId: id,
            action: 'update',
            changedBy: actor,
            oldValue: { name: existing.name, enabled: existing.enabled },
            newValue: {
              name: row.name,
              enabled: row.enabled,
              configKeys: patch.config ? Object.keys(patch.config) : undefined,
              linkedJobsReset,
            },
          },
          tx
        );
        return row;
      })
    );
  } catch (err) {
    if (err instanceof SyncAccountBusyError) {
      throw new ConnectionBusyError(
        'wait for the active sync operation to finish before changing this connection'
      );
    }
    throw err;
  }
}

export async function remove(id: number, actor: string) {
  // A connection in use by a job or ticket is not deletable. Tickets deliberately
  // retain the account they came from even after a job is reassigned; deleting
  // that account would strand them with a dangling syncConnectionId and make
  // fail-closed reconciliation skip every future update.
  const [jobCount, ticketCount] = await Promise.all([
    prisma.syncProvider.count({ where: { connectionId: id } }),
    prisma.ticket.count({ where: { syncConnectionId: id } }),
  ]);
  if (jobCount > 0 || ticketCount > 0) {
    const usage = [
      jobCount > 0 ? `${jobCount} sync job${jobCount === 1 ? '' : 's'}` : null,
      ticketCount > 0 ? `${ticketCount} ticket${ticketCount === 1 ? '' : 's'}` : null,
    ]
      .filter(Boolean)
      .join(' and ');
    throw new ConnectionValidationError(
      `connection is used by ${usage}; reassign those records before deleting it`
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.connection.delete({ where: { id } });
    await auditRepo.record({ entityType: 'connection', entityId: id, action: 'delete', changedBy: actor }, tx);
  });
}

export async function recordTestResult(
  id: number,
  configRevision: number,
  ok: boolean,
  message: string
) {
  const updated = await prisma.connection.updateMany({
    where: { id, configRevision },
    data: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 2000) },
  });
  if (updated.count !== 1) {
    throw new ConnectionTestStaleError(
      'connection credentials changed while the test was running; test the current credentials again'
    );
  }
}

/** The credential config for a sync job, or null when it has no connection. */
export async function configForProvider(connectionId: number | null): Promise<Record<string, unknown> | null> {
  if (connectionId == null) return null;
  const row = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!row || !row.enabled) return null;
  return (row.config ?? {}) as Record<string, unknown>;
}
