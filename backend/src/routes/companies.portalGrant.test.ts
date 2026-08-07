import Fastify from 'fastify';
import * as companyRepo from '../repositories/companyRepository';
import * as portalGrantRepo from '../repositories/portalGrantRepository';
import { requestMagicLink } from '../services/auth/portalMagicLinks';
import { companyRoutes } from './companies';

jest.mock('../repositories/companyRepository');
jest.mock('../repositories/portalGrantRepository');
jest.mock('../repositories/ticketRepository', () => ({}));
jest.mock('../services/auth/portalMagicLinks', () => ({
  requestMagicLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: any, reply: any) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    if (!roles.includes(request.user.role)) {
      return reply.status(403).send({ error: `Requires role: ${roles.join(' or ')}` });
    }
  },
}));

const mockedCompanyRepo = jest.mocked(companyRepo);
const mockedPortalGrantRepo = jest.mocked(portalGrantRepo);
const mockedRequestMagicLink = jest.mocked(requestMagicLink);

async function technicianApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    request.actorSub = 'technician';
  });
  await app.register(companyRoutes);
  await app.ready();
  return app;
}

describe('portal grant routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /contacts/:id/portal-grants lists grant history', async () => {
    mockedPortalGrantRepo.listForContact.mockResolvedValue([{ id: 1 } as never]);
    const app = await technicianApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/contacts/7/portal-grants' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([{ id: 1 }]);
      expect(mockedPortalGrantRepo.listForContact).toHaveBeenCalledWith(7);
    } finally {
      await app.close();
    }
  });

  it('POST /contacts/:id/portal-grant grants access and auto-sends the magic link', async () => {
    mockedCompanyRepo.getContactById.mockResolvedValue({
      id: 7,
      companyId: 3,
      email: 'rita@example.com',
    } as never);
    mockedPortalGrantRepo.grant.mockResolvedValue({ id: 9 } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/contacts/7/portal-grant' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ id: 9 });
      expect(mockedPortalGrantRepo.grant).toHaveBeenCalledWith(
        { contactId: 7, companyId: 3, effectiveFrom: undefined },
        'technician',
      );
      // Fire-and-forget: wait a tick for the setImmediate dispatch.
      await new Promise((r) => setImmediate(r));
      expect(mockedRequestMagicLink).toHaveBeenCalledWith('rita@example.com');
    } finally {
      await app.close();
    }
  });

  it('POST /contacts/:id/portal-grant 404s for an unknown contact', async () => {
    mockedCompanyRepo.getContactById.mockResolvedValue(null);
    const app = await technicianApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/contacts/999/portal-grant' });
      expect(res.statusCode).toBe(404);
      expect(mockedPortalGrantRepo.grant).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('POST /contacts/:id/portal-grant rejects an invalid effectiveFrom', async () => {
    mockedCompanyRepo.getContactById.mockResolvedValue({ id: 7, companyId: 3, email: null } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/contacts/7/portal-grant',
        payload: { effectiveFrom: 'not a date' },
      });
      expect(res.statusCode).toBe(400);
      expect(mockedPortalGrantRepo.grant).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('POST /contacts/:id/portal-grant/revoke revokes the active grant', async () => {
    mockedPortalGrantRepo.revoke.mockResolvedValue({ id: 9, revokedAt: new Date() } as never);
    const app = await technicianApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/contacts/7/portal-grant/revoke' });
      expect(res.statusCode).toBe(200);
      expect(mockedPortalGrantRepo.revoke).toHaveBeenCalledWith(7, 'technician');
    } finally {
      await app.close();
    }
  });

  it('POST /contacts/:id/portal-grant/revoke 404s when there is nothing active', async () => {
    mockedPortalGrantRepo.revoke.mockResolvedValue(null);
    const app = await technicianApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/contacts/7/portal-grant/revoke' });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
