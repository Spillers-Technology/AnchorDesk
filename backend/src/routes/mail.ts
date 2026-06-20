import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mailTransport } from '../services/mail/SmtpMailTransport';
import { getSmtp } from '../services/settingsService';
import * as ticketRepo from '../repositories/ticketRepository';
import * as noteRepo from '../repositories/noteRepository';

interface IdParam { id: string }

export async function mailRoutes(server: FastifyInstance) {
  // Mail config status for the admin UI (never returns credentials).
  server.get('/mail/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const smtp = await getSmtp();
    return reply.send({
      configured: await mailTransport.isConfigured(),
      from: smtp.from,
      host: smtp.host || null,
      port: smtp.port,
      secure: smtp.secure,
    });
  });

  // Send an email from a ticket. The outbound message is recorded as a note so
  // the correspondence stays on the ticket's timeline.
  server.post('/tickets/:id/email', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    if (!(await mailTransport.isConfigured())) {
      return reply.status(503).send({ error: 'SMTP is not configured' });
    }

    const ticketId = parseInt(req.params.id);
    const ticket = await ticketRepo.getById(ticketId);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    const body = req.body as { to?: string | string[]; subject?: string; text?: string; html?: string; cc?: string[] };
    if (!body?.to || !body?.subject) {
      return reply.status(400).send({ error: 'to and subject are required' });
    }

    try {
      const { messageId } = await mailTransport.send({
        to: body.to,
        cc: body.cc,
        subject: body.subject,
        text: body.text,
        html: body.html,
      });

      const author = req.user?.displayName ?? req.actorSub;
      await noteRepo.create(
        ticketId,
        {
          content: `📧 Email sent to ${Array.isArray(body.to) ? body.to.join(', ') : body.to}\nSubject: ${body.subject}\n\n${body.text ?? body.html ?? ''}`,
          author,
        },
        req.actorSub
      );

      return reply.send({ ok: true, messageId });
    } catch (err) {
      server.log.error('Email send failed:', err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });
}
