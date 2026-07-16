jest.mock('../db/prisma', () => ({ prisma: {} }));
jest.mock('./auditRepository', () => ({ record: jest.fn() }));
jest.mock('../services/realtime/eventBus', () => ({ publish: jest.fn() }));
jest.mock('../services/sla', () => ({ computeSlaFields: jest.fn() }));

import { buildWhere } from './ticketRepository';

describe('buildWhere custom-field equality filters', () => {
  it('produces one JSONB path-equals clause per field, ANDed together', () => {
    const where = buildWhere({
      customFieldEquals: { site: 'HQ', seats: 12, vip: true },
    });
    expect(where.AND).toEqual([
      { customFields: { path: ['site'], equals: 'HQ' } },
      { customFields: { path: ['seats'], equals: 12 } },
      { customFields: { path: ['vip'], equals: true } },
    ]);
  });

  it('composes with the other filters instead of replacing them', () => {
    const where = buildWhere({
      teamId: 4,
      customFieldEquals: { site: 'HQ' },
    });
    expect(where.teamId).toBe(4);
    expect(where.AND).toHaveLength(1);
  });

  it('adds no AND clause when the map is absent or empty', () => {
    expect(buildWhere({}).AND).toBeUndefined();
    expect(buildWhere({ customFieldEquals: {} }).AND).toBeUndefined();
  });
});
