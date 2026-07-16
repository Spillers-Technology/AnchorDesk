/**
 * WebSocket endpoint for live updates. The connection inherits the normal auth
 * hook (session cookie or bearer), so `req.user` is already resolved here; we
 * just register the socket under that user in the hub. All fan-out is driven by
 * the event bus via wsHub — this route only manages the connection lifecycle.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { register } from '../services/realtime/wsHub';

export async function wsRoutes(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (socket, req: FastifyRequest) => {
    const userId = req.user?.id;
    if (userId === undefined || userId === null) {
      socket.close();
      return;
    }
    register(userId, socket);
    socket.send(JSON.stringify({ type: 'connected' }));
  });
}
