/**
 * ConnectWise Manage passthrough routes — read directly from CW API.
 *
 * These are legacy/convenience endpoints kept while the CW provider sync is
 * being implemented (Phase 3). Once sync is running, the UI will read from
 * local /tickets endpoints instead. These endpoints use the same DB-backed
 * legacy ConnectWise account as ticket sync.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createCwm } from "../services/connectwiseService";
import { getConnectwise } from "../services/settingsService";
import { ConditionBuilder } from "../services/conditionBuilder";
import { requireConnectWiseBoard } from "../providers/ConnectWiseProvider";

interface TicketIdParam {
  ticketId: string;
}
interface ResourceParam {
  resource: string;
}
interface BoardQuery {
  board?: unknown;
}

async function freshCwm() {
  // These legacy reads do not share a multi-request provider operation, so one
  // fresh database snapshot per request is both sufficient and replica-safe.
  return createCwm(await getConnectwise());
}

export function connectWiseErrorLogContext(err: unknown): {
  remoteStatus?: number;
} {
  // connectwise-rest throws a plain object whose `data` is the raw remote body.
  // A wrong/hostile server can echo Authorization there; never hand that object
  // to Pino. The numeric HTTP status is the only safe useful metadata here.
  const status =
    typeof err === "object" &&
    err !== null &&
    typeof (err as Record<string, unknown>).status === "number"
      ? ((err as Record<string, unknown>).status as number)
      : undefined;
  return status === undefined ? {} : { remoteStatus: status };
}

function logCwFailure(server: FastifyInstance, err: unknown): void {
  server.log.error(connectWiseErrorLogContext(err), "CW fetch failed");
}

function boardFromQuery(
  value: unknown,
  reply: FastifyReply,
): string | undefined {
  try {
    return requireConnectWiseBoard(value);
  } catch {
    reply.status(400).send({
      error: "board query parameter is required and must be nonblank",
    });
    return undefined;
  }
}

export async function cwRoutes(server: FastifyInstance) {
  server.get(
    "/cw/tickets/open",
    async (
      req: FastifyRequest<{ Querystring: BoardQuery }>,
      reply: FastifyReply,
    ) => {
      const board = boardFromQuery(req.query.board, reply);
      if (!board) return;
      const conditions = new ConditionBuilder()
        .addCondition("board/name", "=", board)
        .addNotInCondition("status/name", [
          "Closed",
          "Admin Closed",
          "Complete",
          "Canceled",
          "Closed/No Response",
        ])
        .addCondition("resources", "=", "")
        .addCondition("parentTicketId", "=", null)
        .build();

      try {
        const tickets = await (
          await freshCwm()
        ).ServiceAPI.getServiceTickets({ conditions, page: 1, pageSize: 100 });
        return reply.send(tickets);
      } catch (err) {
        logCwFailure(server, err);
        return reply.status(502).send({ error: "ConnectWise API unavailable" });
      }
    },
  );

  server.get(
    "/cw/tickets/:ticketId",
    async (
      req: FastifyRequest<{ Params: TicketIdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const ticket = await (
          await freshCwm()
        ).ServiceAPI.getServiceTicketsById(parseInt(req.params.ticketId));
        return reply.send(ticket);
      } catch (err) {
        logCwFailure(server, err);
        return reply.status(502).send({ error: "ConnectWise API unavailable" });
      }
    },
  );

  server.get(
    "/cw/tickets/:ticketId/notes",
    async (
      req: FastifyRequest<{ Params: TicketIdParam }>,
      reply: FastifyReply,
    ) => {
      try {
        const notes = await (
          await freshCwm()
        ).ServiceAPI.getServiceTicketsByParentIdNotes(
          parseInt(req.params.ticketId),
          {
            page: 1,
            pageSize: 100,
          },
        );
        return reply.send(notes);
      } catch (err) {
        logCwFailure(server, err);
        return reply.status(502).send({ error: "ConnectWise API unavailable" });
      }
    },
  );

  server.get(
    "/cw/tickets/by-resource/:resource",
    async (
      req: FastifyRequest<{
        Params: ResourceParam;
        Querystring: BoardQuery;
      }>,
      reply: FastifyReply,
    ) => {
      const board = boardFromQuery(req.query.board, reply);
      if (!board) return;
      const conditions = new ConditionBuilder()
        .addCondition("board/name", "=", board)
        .addNotInCondition("status/name", ["Closed", "Complete", "Canceled"])
        .addLikeCondition("resources", req.params.resource)
        .build();

      try {
        const tickets = await (
          await freshCwm()
        ).ServiceAPI.getServiceTickets({ conditions, page: 1, pageSize: 100 });
        return reply.send(tickets);
      } catch (err) {
        logCwFailure(server, err);
        return reply.status(502).send({ error: "ConnectWise API unavailable" });
      }
    },
  );
}
