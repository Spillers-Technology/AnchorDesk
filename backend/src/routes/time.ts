import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as noteRepo from '../repositories/noteRepository';

/** Minutes a time entry represents: an explicit window wins, else the logged
 *  `minutes`, else 0. Keeps placed (windowed) and duration-only entries comparable. */
function entryMinutes(e: { timeStart: Date | null; timeStop: Date | null; minutes: number | null }): number {
  if (e.timeStart && e.timeStop) {
    return Math.max(0, Math.round((e.timeStop.getTime() - e.timeStart.getTime()) / 60000));
  }
  return e.minutes ?? 0;
}

export async function timeRoutes(server: FastifyInstance) {
  // The signed-in user's time entries for a day — the data behind "My Day".
  // The client sends its own local day bounds (from/to) so the day respects the
  // tech's timezone; absent that, fall back to the server's local day.
  server.get('/me/time-entries', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;

    let from: Date;
    let to: Date;
    if (q.from && q.to) {
      from = new Date(q.from);
      to = new Date(q.to);
    } else {
      const base = q.date ? new Date(q.date) : new Date();
      from = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return reply.status(400).send({ error: 'invalid from/to' });
    }

    const rows = await noteRepo.listTimeEntriesForUser(req.user.id, from, to);

    const entries = rows.map((e) => {
      const placed = !!(e.timeStart && e.timeStop);
      return {
        id: e.id,
        ticketId: e.ticketId,
        ticketNumber: e.ticket?.ticketNumber ?? null,
        ticketTitle: e.ticket?.title ?? null,
        content: e.content,
        minutes: entryMinutes(e),
        timeStart: e.timeStart,
        timeStop: e.timeStop,
        workedAt: e.workedAt,
        // A "placed" entry sits on the clock; duration-only ones are unplaced and
        // can't reveal gaps, so the UI keeps them in a separate tray.
        placed,
      };
    });

    const placed = entries.filter((e) => e.placed) as (typeof entries[number] & { timeStart: Date; timeStop: Date })[];
    const loggedMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    const placedMinutes = placed.reduce((s, e) => s + e.minutes, 0);

    return reply.send({
      from,
      to,
      entries,
      summary: {
        loggedMinutes,
        placedMinutes,
        unplacedMinutes: loggedMinutes - placedMinutes,
        firstStart: placed.length ? new Date(Math.min(...placed.map((e) => e.timeStart.getTime()))) : null,
        lastStop: placed.length ? new Date(Math.max(...placed.map((e) => e.timeStop.getTime()))) : null,
        count: entries.length,
      },
    });
  });
}
