import fastify from 'fastify';
import { ticketRoutes } from './routes/tickets';
import { pingRoutes } from './routes/ping';
import { notesRoutes } from './routes/notes';
import { config } from './config/config';

const server = fastify({ logger: true });

// Register routes
server.register(ticketRoutes);
server.register(notesRoutes);  // Registering the notes routes
server.register(pingRoutes);

// Start the server
server.listen({ port: Number(config.serverPort), host: '0.0.0.0' }, (err, address) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  server.log.info(`Server listening at ${address}`);
});
