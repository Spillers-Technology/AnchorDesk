/**
 * syncProviderRepository — CRUD for ticket sync jobs (`sync_providers` rows).
 *
 * A sync job pairs a provider type with an optional `Connection` (which
 * external account) and a small type-specific scope — Jira project/JQL,
 * ConnectWise board — plus the shared provider-neutral `filter`. `toPublic()`
 * is the only shape the API may serialize: it keeps only this type's allowed
 * scope fields, so a stray, legacy, or future-unknown config key can never
 * leak through the read DTO (`GET /sync/providers` previously omitted `config`
 * entirely rather than solve this, which is why editing required delete +
 * recreate).
 */

import { Prisma, ProviderType } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as auditRepo from './auditRepository';
import * as connectionRepo from './connectionRepository';
import { parseSyncFilter, SyncFilter } from '../services/syncFilter';

/** Job types a sync job may target. Wider than `SUPPORTED_CONNECTION_TYPES`:
 *  ConnectWise jobs exist but cannot yet point at a `Connection` (see
 *  connectionRepository — its client is still process-global). */
export const SUPPORTED_PROVIDER_TYPES = ['connectwise', 'jira'] as const;
export type SyncProviderType = (typeof SUPPORTED_PROVIDER_TYPES)[number];

/** Type-specific scope fields a job may set, beyond the shared `filter`. */
const JOB_CONFIG_FIELDS: Record<SyncProviderType, string[]> = {
  jira: ['projectKey', 'jql'],
  connectwise: ['board'],
};

export class SyncProviderValidationError extends Error {}
export class SyncProviderBusyError extends Error {}

function assertRequiredScope(
  type: ProviderType,
  config: Record<string, unknown>
): void {
  if (type === 'connectwise' && (
    typeof config.board !== 'string' ||
    config.board.trim().length === 0
  )) {
    throw new SyncProviderValidationError(
      'a ConnectWise board is required; AnchorDesk never selects a hidden default board'
    );
  }
}

export interface SyncProviderRow {
  id: number;
  name: string;
  type: ProviderType;
  config: Prisma.JsonValue;
  enabled: boolean;
  lastSyncedAt: Date | null;
  configRevision: number;
  createdAt: Date;
  connectionId: number | null;
}

/** The safe read DTO for one job's config: only fields this type recognizes,
 *  plus `filter` when set — re-parsed through the shared vocabulary rather
 *  than copied raw, so a malformed or hand-edited stored filter (which could
 *  otherwise carry arbitrary keys, including something that looks like a
 *  secret) can never reach the API response verbatim. Never the raw stored
 *  JSON. */
export function publicConfig(type: ProviderType, config: Prisma.JsonValue): Record<string, unknown> {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const fields = JOB_CONFIG_FIELDS[type as SyncProviderType] ?? [];
  const out: Record<string, unknown> = {};
  for (const key of fields) {
    if (typeof cfg[key] === 'string' && cfg[key] !== '') out[key] = cfg[key];
  }
  const filter = safeParseFilter(cfg.filter);
  if (filter) out.filter = filter;
  return out;
}

/** `parseSyncFilter`, but swallowing a malformed shape instead of throwing —
 *  for reading data that was already persisted (and validated) rather than
 *  validating new input. A row that somehow ended up with a bad filter reads
 *  as "no filter" instead of 500ing the whole job list. */
function safeParseFilter(raw: unknown): SyncFilter | null {
  try {
    return parseSyncFilter(raw);
  } catch {
    return null;
  }
}

export function toPublic(row: SyncProviderRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt,
    configRevision: row.configRevision,
    createdAt: row.createdAt,
    connectionId: row.connectionId,
    config: publicConfig(row.type, row.config),
  };
}

/**
 * Validate + normalize a config patch against this type's vocabulary. Throws
 * on an unknown key or a malformed filter — a typo must not silently widen or
 * narrow what syncs. A blank string or `null` clears that key; `filter` is
 * parsed through the shared vocabulary so a job's stored filter is always the
 * normalized shape `matches()` expects.
 *
 * `existing` is rebuilt from only this type's allowed keys (via
 * `publicConfig`-equivalent filtering) rather than spread wholesale — a PATCH
 * that only touches `jql`, say, must not silently carry forward a stray key
 * from a legacy or hand-edited row. Every write through this function
 * self-heals the stored config back onto the current vocabulary.
 */
export function mergeJobConfig(
  type: ProviderType,
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const fields = JOB_CONFIG_FIELDS[type as SyncProviderType];
  if (!fields) throw new SyncProviderValidationError(`unsupported provider type "${type}"`);
  const allowed = new Set([...fields, 'filter']);
  const next: Record<string, unknown> = {};
  for (const key of fields) {
    if (typeof existing[key] === 'string' && existing[key] !== '') next[key] = existing[key];
  }
  const existingFilter = safeParseFilter(existing.filter);
  if (existingFilter) next.filter = existingFilter;

  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) {
      throw new SyncProviderValidationError(
        `unknown config field "${key}" for ${type} (allowed: ${[...allowed].join(', ')})`
      );
    }
    if (key === 'filter') {
      let parsed: SyncFilter | null;
      try {
        parsed = parseSyncFilter(value);
      } catch (err) {
        throw new SyncProviderValidationError(`invalid filter: ${(err as Error).message}`);
      }
      if (parsed) next.filter = parsed;
      else delete next.filter;
      continue;
    }
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      delete next[key];
      continue;
    }
    if (typeof value !== 'string') {
      throw new SyncProviderValidationError(`config.${key} must be a string`);
    }
    next[key] = value.trim();
  }
  return next;
}

/** A connection/scope/filter change must force the next run to re-read the full
 *  remote scope. Carrying the old account's incremental watermark across the
 *  edit would permanently skip older tickets that only became visible under
 *  the new configuration. */
export function syncScopeChanged(
  existingConnectionId: number | null,
  nextConnectionId: number | null,
  existingConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>
): boolean {
  return (
    existingConnectionId !== nextConnectionId ||
    JSON.stringify(existingConfig) !== JSON.stringify(nextConfig)
  );
}

/** A linked connection must exist, be of this job's type, and connections must
 *  be supported for this type at all — fails closed rather than silently
 *  ignoring the link. */
async function assertConnection(type: ProviderType, connectionId: number | null): Promise<void> {
  if (connectionId == null) {
    if (type === 'jira') {
      throw new SyncProviderValidationError(
        'a Jira connection is required; choose the account this job may read and write'
      );
    }
    return;
  }
  if (!connectionRepo.SUPPORTED_CONNECTION_TYPES.includes(type as connectionRepo.ConnectionType)) {
    throw new SyncProviderValidationError(`connections are not supported for "${type}" yet`);
  }
  const connection = await connectionRepo.getById(connectionId);
  if (!connection) throw new SyncProviderValidationError(`connection ${connectionId} does not exist`);
  if (connection.type !== type) {
    throw new SyncProviderValidationError(`connection ${connectionId} is a ${connection.type} account, not ${type}`);
  }
}

export async function list() {
  return prisma.syncProvider.findMany({ orderBy: { name: 'asc' } });
}

export async function getByName(name: string) {
  return prisma.syncProvider.findUnique({ where: { name } });
}

export async function create(
  input: {
    name: string;
    type: ProviderType;
    config?: Record<string, unknown>;
    enabled?: boolean;
    connectionId?: number | null;
  },
  actor: string
) {
  if (!SUPPORTED_PROVIDER_TYPES.includes(input.type as SyncProviderType)) {
    throw new SyncProviderValidationError(`type must be one of: ${SUPPORTED_PROVIDER_TYPES.join(', ')}`);
  }
  const connectionId = input.connectionId ?? null;
  await assertConnection(input.type, connectionId);
  const config = mergeJobConfig(input.type, {}, input.config ?? {});
  assertRequiredScope(input.type, config);

  // Mutation and audit row commit together — a mutation that lands without an
  // audit trail would violate "full audit log on every mutation."
  return prisma.$transaction(async (tx) => {
    const row = await tx.syncProvider.create({
      data: {
        name: input.name.trim(),
        type: input.type,
        enabled: input.enabled ?? true,
        config: config as Prisma.InputJsonValue,
        connectionId,
      },
    });
    await auditRepo.record(
      {
        entityType: 'sync_provider',
        entityId: row.id,
        action: 'create',
        changedBy: actor,
        newValue: { name: row.name, type: row.type, connectionId: row.connectionId, config },
      },
      tx
    );
    return row;
  });
}

export async function update(
  id: number,
  patch: { name?: string; enabled?: boolean; config?: Record<string, unknown>; connectionId?: number | null },
  actor: string
) {
  const existing = await prisma.syncProvider.findUnique({ where: { id } });
  if (!existing) return null;

  if (patch.connectionId !== undefined) await assertConnection(existing.type, patch.connectionId);
  if (
    existing.type === 'jira' &&
    existing.connectionId == null &&
    patch.connectionId === undefined
  ) {
    const disableOnly =
      patch.enabled === false &&
      patch.name === undefined &&
      patch.config === undefined;
    if (!disableOnly) {
      throw new SyncProviderValidationError(
        'this Jira job has no connection; choose the exact Jira account before editing or enabling it'
      );
    }
  }

  const data: Prisma.SyncProviderUncheckedUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.connectionId !== undefined) data.connectionId = patch.connectionId;
  const existingPublicConfig = publicConfig(existing.type, existing.config);
  let nextConfig = existingPublicConfig;
  if (patch.config !== undefined) {
    nextConfig = mergeJobConfig(
      existing.type,
      (existing.config ?? {}) as Record<string, unknown>,
      patch.config
    );
    data.config = nextConfig as Prisma.InputJsonValue;
  }
  if (existing.type === 'connectwise') {
    const hasBoard =
      typeof nextConfig.board === 'string' &&
      nextConfig.board.trim().length > 0;
    const disableOnly =
      !hasBoard &&
      patch.enabled === false &&
      patch.name === undefined &&
      patch.config === undefined &&
      patch.connectionId === undefined;
    if (!disableOnly) assertRequiredScope(existing.type, nextConfig);
  }
  const nextConnectionId = patch.connectionId !== undefined ? patch.connectionId : existing.connectionId;
  const watermarkReset = syncScopeChanged(
    existing.connectionId,
    nextConnectionId,
    existingPublicConfig,
    nextConfig
  );
  if (watermarkReset) {
    data.lastSyncedAt = null;
    data.configRevision = { increment: 1 };
  }

  return prisma.$transaction(async (tx) => {
    let row;
    if (watermarkReset) {
      // Serialize scope/account edits against SyncRun.start() on every replica.
      // If a run wins first, changing its credentials or query underneath
      // in-flight remote work is unsafe even though the old watermark is CAS
      // protected. If this edit wins, the revision increment makes the stale
      // run start fail before any remote request.
      const locked = await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM sync_providers
        WHERE id = ${id} AND config_revision = ${existing.configRevision}
        FOR UPDATE
      `;
      if (locked.length !== 1) {
        throw new SyncProviderValidationError(
          'sync job scope changed concurrently; reload it and try again'
        );
      }
      const running = await tx.syncRun.count({
        where: { providerId: id, status: 'running' },
      });
      if (running > 0) {
        throw new SyncProviderBusyError(
          'wait for the active sync run to finish before changing its account or scope'
        );
      }
      // Compare-and-set the revision so two simultaneous scope edits cannot
      // both derive their new configuration from the same stale row.
      const changed = await tx.syncProvider.updateMany({
        where: { id, configRevision: existing.configRevision },
        data,
      });
      if (changed.count !== 1) {
        throw new SyncProviderValidationError(
          'sync job scope changed concurrently; reload it and try again'
        );
      }
      row = await tx.syncProvider.findUniqueOrThrow({ where: { id } });
    } else {
      row = await tx.syncProvider.update({ where: { id }, data });
    }
    await auditRepo.record(
      {
        entityType: 'sync_provider',
        entityId: id,
        action: 'update',
        changedBy: actor,
        oldValue: { name: existing.name, enabled: existing.enabled, connectionId: existing.connectionId },
        newValue: {
          name: row.name,
          enabled: row.enabled,
          connectionId: row.connectionId,
          configKeys: patch.config ? Object.keys(patch.config) : undefined,
          watermarkReset,
        },
      },
      tx
    );
    return row;
  });
}

/** Deletes the job and its sync log (cascade in the schema). Returns false if
 *  the job did not exist. */
export async function remove(id: number, actor: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Serialize against SyncRun.start(), which takes a FOR UPDATE lock on this
    // same row before inserting a running attempt. If start wins, we see the
    // running row and refuse; if delete wins, start finds no provider. This
    // prevents another replica from cascading away the run while its worker is
    // still performing outbound writes.
    const locked = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM sync_providers WHERE id = ${id} FOR UPDATE
    `;
    if (locked.length === 0) return false;

    const running = await tx.syncRun.count({
      where: { providerId: id, status: 'running' },
    });
    if (running > 0) {
      throw new SyncProviderBusyError(
        'wait for the active sync run to finish before deleting this job'
      );
    }

    const existing = await tx.syncProvider.findUniqueOrThrow({ where: { id } });
    await tx.syncProvider.delete({ where: { id } });
    await auditRepo.record(
      {
        entityType: 'sync_provider',
        entityId: id,
        action: 'delete',
        changedBy: actor,
        oldValue: { name: existing.name, type: existing.type },
      },
      tx
    );
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
