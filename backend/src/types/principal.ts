import type { FastifyRequest } from 'fastify';

/**
 * A requester is a customer Contact, never a staff User with a reduced role.
 *
 * The authentication layer resolves this value from a portal-scoped server-side
 * session. Portal business routes consume only this deliberately small identity
 * shape, which keeps staff RBAC concepts out of the requester boundary.
 */
export interface RequesterPrincipal {
  kind: 'requester';
  contactId: number;
  companyId: number;
  name: string;
  email: string;
}

export function isRequesterPrincipal(value: unknown): value is RequesterPrincipal {
  if (!value || typeof value !== 'object') return false;
  const principal = value as Partial<RequesterPrincipal>;
  return (
    principal.kind === 'requester' &&
    Number.isInteger(principal.contactId) &&
    Number(principal.contactId) > 0 &&
    Number.isInteger(principal.companyId) &&
    Number(principal.companyId) > 0 &&
    typeof principal.name === 'string' &&
    typeof principal.email === 'string' &&
    principal.email.trim().length > 0
  );
}

/**
 * Read the neutral `request.principal` slot without widening the existing
 * `request.user` staff contract. The auth middleware owns populating the slot.
 */
export function requesterPrincipalFor(request: FastifyRequest): RequesterPrincipal | null {
  const principal = (request as FastifyRequest & { principal?: unknown }).principal;
  return isRequesterPrincipal(principal) ? principal : null;
}
