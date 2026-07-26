import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as attachmentRepo from '../repositories/attachmentRepository';
import * as ticketRepo from '../repositories/ticketRepository';
import { currentStorage, storageForBackend, buildKey } from '../services/storage';

interface IdParam { id: string }

export async function attachmentRoutes(server: FastifyInstance) {
  // List attachment metadata for a ticket.
  server.get('/tickets/:id/attachments', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const ticketId = parseInt(req.params.id);
    return reply.send(await attachmentRepo.listForTicket(ticketId));
  });

  // Upload one or more files to a ticket (multipart/form-data). Each file part is
  // streamed into the configured storage backend, then a metadata row is written.
  server.post('/tickets/:id/attachments', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const ticketId = parseInt(req.params.id);
    const ticket = await ticketRepo.getById(ticketId);
    if (!ticket) return reply.status(404).send({ error: 'Ticket not found' });

    if (!req.isMultipart()) return reply.status(400).send({ error: 'Expected multipart/form-data' });

    const storage = await currentStorage();
    const created = [];
    try {
      for await (const part of req.files()) {
        const buffer = await part.toBuffer(); // honors the fileSize limit; throws if exceeded
        const key = buildKey(ticketId, part.filename);
        const contentType = part.mimetype || 'application/octet-stream';
        await storage.put(key, buffer, contentType);
        const row = await attachmentRepo.create(
          {
            ticketId,
            filename: part.filename,
            contentType,
            size: buffer.length,
            storageBackend: storage.backend,
            storageKey: key,
            createdBy: req.actorSub,
            portalVisible: false,
          },
          req.actorSub,
        );
        created.push(row);
      }
    } catch (err) {
      req.log.error({ err }, 'Attachment upload failed');
      return reply.status(413).send({ error: (err as Error).message || 'Upload failed' });
    }

    if (created.length === 0) return reply.status(400).send({ error: 'No files in request' });
    return reply.status(201).send(created);
  });

  // Download an attachment's bytes, streamed from its recorded backend.
  server.get('/attachments/:id/download', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const row = await attachmentRepo.getById(parseInt(req.params.id));
    if (!row) return reply.status(404).send({ error: 'Attachment not found' });

    const storage = await storageForBackend(row.storageBackend);
    let stream;
    try {
      stream = await storage.get(row.storageKey);
    } catch (err) {
      req.log.error({ err }, 'Attachment fetch failed');
      return reply.status(404).send({ error: 'Attachment bytes not found' });
    }
    reply.header('Content-Type', row.contentType);
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
    return reply.send(stream);
  });

  // Delete an attachment (bytes + metadata row).
  server.delete('/attachments/:id', async (req: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) => {
    const row = await attachmentRepo.getById(parseInt(req.params.id));
    if (!row) return reply.status(404).send({ error: 'Attachment not found' });
    const storage = await storageForBackend(row.storageBackend);
    await storage.delete(row.storageKey).catch((err) => req.log.warn({ err }, 'Storage delete failed'));
    await attachmentRepo.remove(row.id, req.actorSub);
    return reply.status(204).send();
  });
}
