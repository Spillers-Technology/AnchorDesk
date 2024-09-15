// src/routes/ping.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function pingRoutes(server: FastifyInstance) {
  server.get('/ping', async (request: FastifyRequest, reply: FastifyReply) => {
    return 'pong\n';
  });
}
