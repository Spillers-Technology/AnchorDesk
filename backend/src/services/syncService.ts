/**
 * Sync service — ingests tickets from a TicketProvider into the local database.
 *
 * Designed to be called on-demand (via API) or on a schedule.
 * All sync activity is recorded in sync_log for observability.
 *
 * GoF pattern: Factory — createProvider() instantiates the correct
 * TicketProvider implementation based on the sync_providers.type column.
 */

import { TicketSource } from '@prisma/client';
import { prisma } from '../db/prisma';
import { TicketProvider } from '../providers/TicketProvider';
import { createTicketProvider } from '../providers/ticketProviderFactory';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';
import * as twoWaySync from './twoWaySync';

export interface SyncResult {
  providerId: number;
  providerName: string;
  ticketsCreated: number;
  ticketsUpdated: number;
  notesUpserted: number;
  errors: string[];
  durationMs: number;
}

/** Run a full sync for a single provider. Returns a result summary. */
export async function runSync(providerRow: {
  id: number;
  name: string;
  type: string;
  config: unknown;
  lastSyncedAt: Date | null;
}): Promise<SyncResult> {
  const start = Date.now();
  const result: SyncResult = {
    providerId: providerRow.id,
    providerName: providerRow.name,
    ticketsCreated: 0,
    ticketsUpdated: 0,
    notesUpserted: 0,
    errors: [],
    durationMs: 0,
  };

  const config = (providerRow.config ?? {}) as Record<string, unknown>;
  const provider = createTicketProvider(providerRow.type, config);
  // Two-way providers reconcile existing tickets (conflict-aware) instead of the
  // blind inbound overwrite used for read-only sources.
  const twoWay = provider.canWriteBack === true;

  // Incremental: only fetch records updated since the last sync
  const since = providerRow.lastSyncedAt ?? undefined;

  let externalTickets: Awaited<ReturnType<TicketProvider['fetchTickets']>> = [];
  try {
    externalTickets = await provider.fetchTickets(since);
  } catch (err) {
    const msg = `Failed to fetch tickets from ${providerRow.name}: ${(err as Error).message}`;
    result.errors.push(msg);
    result.durationMs = Date.now() - start;
    return result;
  }

  const source = provider.name as TicketSource;

  for (const ext of externalTickets) {
    try {
      // Two-way providers: create-if-missing, then reconcile (conflict-aware).
      // A blind overwrite would clobber unsynced local edits, so existing tickets
      // never go through upsertExternal here.
      if (twoWay) {
        const existing = await prisma.ticket.findUnique({
          where: { externalId_externalProvider: { externalId: ext.externalId, externalProvider: provider.name } },
        });
        let localId: number;
        if (existing) {
          localId = existing.id;
        } else {
          const t = await ticketRepo.create(
            {
              title: ext.title,
              summary: ext.summary,
              description: ext.description,
              status: ext.status,
              priority: ext.priority,
              companyName: ext.companyName,
              assignee: ext.assignee,
              ticketNumber: ext.ticketNumber,
              source,
              externalId: ext.externalId,
              externalProvider: provider.name,
            },
            'system'
          );
          localId = t.id;
          result.ticketsCreated++;
        }

        const r = await twoWaySync.reconcileTicket(localId, { remote: ext, actor: 'system' });
        if (r.outcome === 'pulled' || r.outcome === 'pushed') result.ticketsUpdated++;
        if (r.outcome === 'conflict') {
          result.errors.push(`Ticket ${ext.externalId}: conflict held for manual resolution`);
        }

        await prisma.syncLog.create({
          data: {
            providerId: providerRow.id,
            externalId: ext.externalId,
            direction: r.outcome === 'pushed' ? 'outbound' : 'inbound',
            status: r.outcome === 'error' ? 'error' : r.outcome === 'conflict' ? 'skipped' : 'success',
            message: r.message,
          },
        });
        continue;
      }

      const { created } = await ticketRepo.upsertExternal(
        ext.externalId,
        provider.name,
        {
          title: ext.title,
          summary: ext.summary,
          description: ext.description,
          status: ext.status,
          priority: ext.priority,
          companyName: ext.companyName,
          assignee: ext.assignee,
          ticketNumber: ext.ticketNumber,
          source,
        },
        'system'
      );

      if (created) {
        result.ticketsCreated++;
      } else {
        result.ticketsUpdated++;
      }

      // Log success
      await prisma.syncLog.create({
        data: {
          providerId: providerRow.id,
          externalId: ext.externalId,
          direction: 'inbound',
          status: 'success',
        },
      });

      // Sync notes for this ticket
      try {
        const externalNotes = await provider.fetchNotes(ext.externalId);
        const localTicket = await prisma.ticket.findUnique({
          where: { externalId_externalProvider: { externalId: ext.externalId, externalProvider: provider.name } },
        });

        if (localTicket) {
          for (const n of externalNotes) {
            // Upsert by external_id to avoid duplicates on re-sync
            const existing = await prisma.note.findFirst({
              where: { ticketId: localTicket.id, externalId: n.externalId },
            });

            if (!existing) {
              await noteRepo.create(
                localTicket.id,
                {
                  content: n.content,
                  author: n.author,
                  noteType: n.noteType,
                  timeStart: n.timeStart,
                  timeStop: n.timeStop,
                  externalId: n.externalId,
                },
                'system'
              );
              result.notesUpserted++;
            }
          }
        }
      } catch (noteErr) {
        // Note sync failure is non-fatal — ticket was still synced
        result.errors.push(`Notes for ${ext.externalId}: ${(noteErr as Error).message}`);
      }
    } catch (err) {
      const msg = `Ticket ${ext.externalId}: ${(err as Error).message}`;
      result.errors.push(msg);

      await prisma.syncLog.create({
        data: {
          providerId: providerRow.id,
          externalId: ext.externalId,
          direction: 'inbound',
          status: 'error',
          message: msg,
        },
      });
    }
  }

  // Update last_synced_at regardless of individual record errors
  await prisma.syncProvider.update({
    where: { id: providerRow.id },
    data: { lastSyncedAt: new Date() },
  });

  result.durationMs = Date.now() - start;
  return result;
}

/** Run sync for all enabled providers. */
export async function runAllSync(): Promise<SyncResult[]> {
  const providers = await prisma.syncProvider.findMany({ where: { enabled: true } });
  const results: SyncResult[] = [];

  for (const p of providers) {
    const result = await runSync(p as Parameters<typeof runSync>[0]);
    results.push(result);
  }

  return results;
}
