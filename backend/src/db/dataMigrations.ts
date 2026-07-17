/**
 * Idempotent boot-time data migrations — the data counterpart to the schema
 * `prisma db push` the containers run before start. Each fix is a no-op once
 * applied, so running on every boot is safe and old instances upgrade just by
 * pulling a newer image. Only LOCAL tickets are touched: external providers
 * own their status/priority vocabularies.
 */
import { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../services/ticketVocab';

export async function runDataMigrations(log: FastifyBaseLogger): Promise<void> {
  let fixed = 0;

  // 2.4.0 — the MCP tools historically taught agents a fictional "open"
  // status and a numeric priority scale; the backend accepted any casing.
  // Canonicalize local tickets so they land back in board columns, status
  // filters, and SLA policy matches.
  for (const status of TICKET_STATUSES) {
    const r = await prisma.$executeRaw`
      UPDATE tickets SET status = ${status}
      WHERE external_provider IS NULL AND status <> ${status} AND lower(status) = ${status.toLowerCase()}`;
    fixed += r;
  }
  fixed += await prisma.$executeRaw`
    UPDATE tickets SET status = 'New'
    WHERE external_provider IS NULL AND lower(status) = 'open'`;

  for (const priority of TICKET_PRIORITIES) {
    const r = await prisma.$executeRaw`
      UPDATE tickets SET priority = ${priority}
      WHERE external_provider IS NULL AND priority <> ${priority} AND lower(priority) = ${priority.toLowerCase()}`;
    fixed += r;
  }
  // Legacy numeric priorities (pre-1.3 scale; '3' was the old MCP default).
  const numericMap: [string, string][] = [
    ['1', 'Critical'],
    ['2', 'High'],
    ['3', 'Medium'],
    ['4', 'Low'],
    ['5', 'Low'],
    ['6', 'Low'],
  ];
  for (const [digit, priority] of numericMap) {
    fixed += await prisma.$executeRaw`
      UPDATE tickets SET priority = ${priority}
      WHERE external_provider IS NULL AND priority = ${digit}`;
  }

  if (fixed > 0) log.info(`Data migrations normalized ${fixed} ticket status/priority values.`);
}
