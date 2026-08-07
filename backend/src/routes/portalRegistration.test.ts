jest.mock('../services/settingsService', () => ({ isPortalEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/companyResolution', () => ({ findCompanyForEmailDomain: jest.fn() }));
jest.mock('../services/auth/portalMagicLinks', () => ({
  normalizePortalEmail: (value: unknown) => typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null,
  requestMagicLink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../repositories/portalRegistrationRepository');
jest.mock('../middleware/auth', () => ({
  requireRole: (...roles: string[]) => async (request: any, reply: any) => {
    if (!request.user) return reply.status(401).send({ error: 'Authentication required' });
    if (!roles.includes(request.user.role)) return reply.status(403).send({ error: `Requires role: ${roles.join(' or ')}` });
  },
}));

import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import * as companyResolution from '../services/companyResolution';
import * as magicLinks from '../services/auth/portalMagicLinks';
import * as registrations from '../repositories/portalRegistrationRepository';
import {
  PORTAL_REGISTRATION_GENERIC_RESPONSE,
  portalRegistrationRoutes,
} from './portalRegistration';

const mockedCompanyResolution = jest.mocked(companyResolution);
const mockedMagicLinks = jest.mocked(magicLinks);
const mockedRegistrations = jest.mocked(registrations);

async function nextImmediate(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function appFor(role?: 'admin' | 'technician'): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request) => {
    request.actorSub = 'alice';
    if (role) request.user = { role } as never;
  });
  await app.register(portalRegistrationRoutes);
  await app.ready();
  return app;
}

describe('portal registration routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRegistrations.validatedRegistrationStatus.mockImplementation((value) => (
      typeof value === 'string' && ['pending', 'approved', 'rejected'].includes(value.toLowerCase())
        ? value.toLowerCase()
        : null
    ));
  });

  it('returns the same generic response before domain matching and persistence complete', async () => {
    mockedCompanyResolution.findCompanyForEmailDomain.mockResolvedValue({ id: 4 } as never);
    mockedRegistrations.create.mockResolvedValue({ id: 7 } as never);
    const app = await appFor();
    try {
      const known = await app.inject({ method: 'POST', url: '/portal/register', payload: { email: 'rita@example.com' } });
      const invalid = await app.inject({ method: 'POST', url: '/portal/register', payload: { email: 'not an email' } });
      expect(known.statusCode).toBe(202);
      expect(invalid.statusCode).toBe(202);
      expect(known.json()).toEqual(PORTAL_REGISTRATION_GENERIC_RESPONSE);
      expect(known.body).toBe(invalid.body);
      expect(known.headers['cache-control']).toBe('no-store');
      await nextImmediate();
      expect(mockedCompanyResolution.findCompanyForEmailDomain).toHaveBeenCalledWith('rita@example.com');
      expect(mockedRegistrations.create).toHaveBeenCalledWith({ email: 'rita@example.com', companyId: 4 }, 'anonymous (portal-registration)');
    } finally {
      await app.close();
    }
  });

  it('uses both per-email and per-IP registration throttles', async () => {
    const app = await appFor();
    try {
      for (let count = 0; count < 5; count++) {
        expect((await app.inject({ method: 'POST', url: '/portal/register', payload: { email: 'rita@example.com' } })).statusCode).toBe(202);
      }
      expect((await app.inject({ method: 'POST', url: '/portal/register', payload: { email: 'rita@example.com' } })).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });

  it('requires admin for the queue and validates its status filter', async () => {
    const technician = await appFor('technician');
    try {
      expect((await technician.inject({ method: 'GET', url: '/portal-registrations' })).statusCode).toBe(403);
    } finally { await technician.close(); }

    const admin = await appFor('admin');
    try {
      expect((await admin.inject({ method: 'GET', url: '/portal-registrations?status=waiting' })).statusCode).toBe(400);
      mockedRegistrations.list.mockResolvedValue([{ id: 7 } as never]);
      const response = await admin.inject({ method: 'GET', url: '/portal-registrations?status=PENDING' });
      expect(response.statusCode).toBe(200);
      expect(mockedRegistrations.list).toHaveBeenCalledWith('pending');
    } finally { await admin.close(); }
  });

  it('approves a registration and dispatches its magic link without blocking the response', async () => {
    mockedRegistrations.approve.mockResolvedValue({ id: 7, email: 'rita@example.com' } as never);
    const app = await appFor('admin');
    try {
      const response = await app.inject({ method: 'POST', url: '/portal-registrations/7/approve' });
      expect(response.statusCode).toBe(200);
      expect(mockedRegistrations.approve).toHaveBeenCalledWith(7, 'alice');
      await nextImmediate();
      expect(mockedMagicLinks.requestMagicLink).toHaveBeenCalledWith('rita@example.com');
    } finally { await app.close(); }
  });

  it('rejects one pending registration', async () => {
    mockedRegistrations.reject.mockResolvedValue({ id: 7, status: 'rejected' } as never);
    const app = await appFor('admin');
    try {
      const response = await app.inject({ method: 'POST', url: '/portal-registrations/7/reject' });
      expect(response.statusCode).toBe(200);
      expect(mockedRegistrations.reject).toHaveBeenCalledWith(7, 'alice');
    } finally { await app.close(); }
  });
});
