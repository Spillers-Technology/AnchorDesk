jest.mock('../../../repositories/portalAuthRepository', () => ({
  findUniqueRequesterByEmail: jest.fn(),
  createMagicLink: jest.fn(),
  findMagicLinkBySelectorHash: jest.fn(),
  consumeMagicLinkAndCreateSession: jest.fn(),
  pruneExpiredMagicLinks: jest.fn(),
}));
jest.mock('../../mail/SmtpMailTransport', () => ({
  mailTransport: {
    isConfigured: jest.fn(),
    send: jest.fn(),
  },
}));

import * as portalAuthRepository from '../../../repositories/portalAuthRepository';
import { mailTransport } from '../../mail/SmtpMailTransport';
import {
  generateMagicToken,
  normalizePortalEmail,
  parseMagicToken,
  PORTAL_MAGIC_PREFIX,
  PORTAL_MAGIC_TTL_MS,
  redeemMagicLink,
  requestMagicLink,
} from '../portalMagicLinks';

const repo = jest.mocked(portalAuthRepository);
const transport = jest.mocked(mailTransport);

const requester = {
  kind: 'requester' as const,
  contactId: 22,
  companyId: 9,
  name: 'Rita Requester',
  email: 'rita@example.com',
};

describe('portal magic-link token crypto', () => {
  it('uses a 128-bit selector and 256-bit verifier while storing only SHA-256 digests', () => {
    const token = generateMagicToken();
    const parsed = parseMagicToken(token.raw);

    expect(token.raw).toMatch(
      new RegExp(`^${PORTAL_MAGIC_PREFIX}[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`),
    );
    expect(parsed).not.toBeNull();
    expect(token.selectorHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.verifierHash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.selectorHash).not.toContain(parsed!.selector);
    expect(token.verifierHash).not.toContain(parsed!.verifier);
  });

  it('mints independent credentials and rejects malformed formats', () => {
    expect(generateMagicToken().raw).not.toBe(generateMagicToken().raw);
    expect(parseMagicToken('')).toBeNull();
    expect(parseMagicToken('adp_short.short')).toBeNull();
    expect(parseMagicToken('x'.repeat(1_000))).toBeNull();
  });

  it('normalizes conservatively without collapsing provider aliases', () => {
    expect(normalizePortalEmail(' Rita+Billing@Example.COM ')).toBe(
      'rita+billing@example.com',
    );
    expect(normalizePortalEmail('two@@example.com')).toBeNull();
    expect(normalizePortalEmail('line\r\nbreak@example.com')).toBeNull();
  });
});

describe('portal magic-link issue/redeem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transport.isConfigured.mockResolvedValue(true);
    transport.send.mockResolvedValue({ messageId: '<mail@example.com>' });
    repo.findUniqueRequesterByEmail.mockResolvedValue(requester);
    repo.createMagicLink.mockResolvedValue({ id: 4 });
  });

  it('persists only token hashes and delivers a fragment URL', async () => {
    await requestMagicLink('RITA@example.com');

    expect(repo.createMagicLink).toHaveBeenCalledWith({
      contactId: 22,
      expectedCompanyId: 9,
      expectedEmail: 'rita@example.com',
      selectorHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      verifierHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      expiresAt: expect.any(Date),
    });
    const expiresAt = repo.createMagicLink.mock.calls[0][0].expiresAt;
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      PORTAL_MAGIC_TTL_MS,
    );
    const sent = transport.send.mock.calls[0][0];
    expect(sent.to).toBe('rita@example.com');
    expect(sent.text).toContain('/portal/login#token=adp_');
    expect(sent.text).not.toContain('/portal/login?token=');
    expect(JSON.stringify(repo.createMagicLink.mock.calls[0][0])).not.toContain(
      'adp_',
    );
  });

  it('does not mail a link when the locked Contact no longer matches the lookup', async () => {
    repo.createMagicLink.mockResolvedValue(null);

    await requestMagicLink('rita@example.com');

    expect(repo.createMagicLink).toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('does no write or mail for an unknown/ambiguous address', async () => {
    repo.findUniqueRequesterByEmail.mockResolvedValue(null);
    await requestMagicLink('nobody@example.com');
    expect(repo.createMagicLink).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('redeems a matching verifier into a hashed 24-hour session', async () => {
    const generated = generateMagicToken();
    repo.findMagicLinkBySelectorHash.mockResolvedValue({
      id: 4,
      contactId: 22,
      verifierHash: generated.verifierHash,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    repo.consumeMagicLinkAndCreateSession.mockResolvedValue(requester);

    const result = await redeemMagicLink(generated.raw, {
      userAgent: 'browser',
      ip: '127.0.0.1',
    });
    expect(result?.requester).toEqual(requester);
    expect(result?.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.consumeMagicLinkAndCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        linkId: 4,
        contactId: 22,
        actor: 'requester:22 (portal)',
        session: expect.objectContaining({
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          userAgent: 'browser',
          ip: '127.0.0.1',
          expiresAt: expect.any(Date),
        }),
      }),
    );
    const session =
      repo.consumeMagicLinkAndCreateSession.mock.calls[0][0].session;
    expect(session.tokenHash).not.toBe(result?.sessionToken);
  });

  it('constant-digest rejects a wrong verifier before consumption', async () => {
    const presented = generateMagicToken();
    const other = generateMagicToken();
    repo.findMagicLinkBySelectorHash.mockResolvedValue({
      id: 4,
      contactId: 22,
      verifierHash: other.verifierHash,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      redeemMagicLink(presented.raw, {}),
    ).resolves.toBeNull();
    expect(repo.consumeMagicLinkAndCreateSession).not.toHaveBeenCalled();
  });

  it('returns the same null result when atomic consume loses a replay/expiry race', async () => {
    const generated = generateMagicToken();
    repo.findMagicLinkBySelectorHash.mockResolvedValue({
      id: 4,
      contactId: 22,
      verifierHash: generated.verifierHash,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1),
    });
    repo.consumeMagicLinkAndCreateSession.mockResolvedValue(null);

    await expect(redeemMagicLink(generated.raw, {})).resolves.toBeNull();
  });
});
