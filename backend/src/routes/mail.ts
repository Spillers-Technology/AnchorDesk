import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mailTransport } from '../services/mail/SmtpMailTransport';
import { getSmtp } from '../services/settingsService';
import * as ticketMail from '../services/mail/ticketMail';
import * as userRepo from '../repositories/userRepository';

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

  // Send an email from a ticket. Threading + recording the correspondence as an
  // `email` note is handled by the ticketMail service (see services/mail/ticketMail).
  server.post('/tickets/:id/email', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    if (!(await mailTransport.isConfigured())) {
      return reply.status(503).send({ error: 'SMTP is not configured' });
    }

    const ticketId = parseInt(req.params.id);
    const body = req.body as {
      to?: string | string[]; subject?: string; text?: string; html?: string;
      cc?: string[]; bcc?: string[]; attachmentIds?: number[];
      fromIdentityId?: number; includeSignature?: boolean;
    };
    if (!body?.to || !body?.subject) {
      return reply.status(400).send({ error: 'to and subject are required' });
    }
    if (!body.text && !body.html) {
      return reply.status(400).send({ error: 'a message body (text or html) is required' });
    }

    try {
      const author = req.user?.displayName ?? req.actorSub;
      // Pull the sender's saved signature only when they asked to include it.
      const signatureHtml = body.includeSignature
        ? (await userRepo.findById(req.user.id))?.signatureHtml ?? undefined
        : undefined;
      const { messageId } = await ticketMail.sendTicketEmail(ticketId, {
        to: body.to,
        cc: body.cc,
        bcc: body.bcc,
        subject: body.subject,
        text: body.text,
        html: body.html,
        author,
        attachmentIds: body.attachmentIds,
        fromIdentityId: body.fromIdentityId,
        signatureHtml,
      });
      return reply.send({ ok: true, messageId });
    } catch (err) {
      const e = err as { statusCode?: number; responseCode?: number; response?: string; message: string };
      if (e.statusCode === 404) return reply.status(404).send({ error: e.message });
      server.log.error({ err }, 'Email send failed');
      // A 5xx from the relay when a send-from identity was chosen almost always
      // means the relay won't let us send as that address (sender != the
      // authenticated account). Surface that clearly instead of a bare 502.
      if (e.responseCode && e.responseCode >= 500 && body.fromIdentityId) {
        return reply.status(422).send({
          error:
            'The mail server rejected the chosen "From" identity. Your SMTP relay may not permit sending as this address — ' +
            'use an alias on the SMTP domain or allow it on the relay.' +
            (e.response ? ` (server said: ${e.response})` : ''),
        });
      }
      return reply.status(502).send({ error: e.message });
    }
  });
}
