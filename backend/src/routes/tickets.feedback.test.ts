jest.mock('../repositories/ticketRepository', () => ({ getById: jest.fn() }));
jest.mock('../repositories/ticketFeedbackRepository', () => ({ listForTicket: jest.fn() }));

import Fastify from 'fastify';
import * as ticketRepo from '../repositories/ticketRepository';
import * as ticketFeedbackRepo from '../repositories/ticketFeedbackRepository';
import { ticketRoutes } from './tickets';

const getTicket = ticketRepo.getById as jest.Mock;
const listFeedback = ticketFeedbackRepo.listForTicket as jest.Mock;

describe('staff ticket feedback read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('folds read-only feedback rows into GET /tickets/:id', async () => {
    getTicket.mockResolvedValue({ id: 42, title: 'Printer offline' });
    listFeedback.mockResolvedValue([{
      id: 7,
      ticketId: 42,
      rating: 'positive',
      comment: 'Quick fix',
      contact: { id: 9, name: 'Casey Customer', email: 'casey@example.test' },
      submittedAt: new Date('2026-08-06T12:00:00.000Z'),
    }]);
    const app = Fastify();
    await app.register(ticketRoutes);
    await app.ready();
    try {
      const response = await app.inject({ method: 'GET', url: '/tickets/42' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 42,
        feedback: [{ id: 7, rating: 'positive', contact: { name: 'Casey Customer' } }],
      });
      expect(listFeedback).toHaveBeenCalledWith(42);
    } finally {
      await app.close();
    }
  });
});
