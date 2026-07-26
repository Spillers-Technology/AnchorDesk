/**
 * Defense-in-depth for portal knowledge-base reads.
 *
 * The global authentication hook resolves the server-side Contact session and
 * applies its positive route allowlist first. KB handlers still call this
 * helper so registering the routes without that hook cannot accidentally make
 * customer content anonymous.
 */
import type { FastifyRequest } from 'fastify';
import { requesterPrincipalFor } from '../types/principal';

export function isPortalKbReadRequest(request: Pick<FastifyRequest, 'method' | 'url'>): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  try {
    const url = new URL(request.url, 'http://anchordesk.local');
    if (url.pathname === '/kb/search') {
      const keys = Array.from(url.searchParams.keys());
      if (keys.some((key) => !['q', 'visibility', 'limit'].includes(key))) {
        return false;
      }
      const query = url.searchParams.getAll('q');
      const visibility = url.searchParams.getAll('visibility');
      const limit = url.searchParams.getAll('limit');
      return (
        query.length === 1 &&
        query[0].trim().length > 0 &&
        query[0].length <= 500 &&
        visibility.length === 1 &&
        visibility[0] === 'portal' &&
        limit.length === 1 &&
        limit[0] === '5'
      );
    }
    if (url.search !== '') return false;
    const match = /^\/kb\/portal\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname);
    return Boolean(match && match[1].length <= 200);
  } catch {
    return false;
  }
}

export async function authorizePortalKbRead(
  request: FastifyRequest,
): Promise<boolean> {
  if (!isPortalKbReadRequest(request)) return false;
  return requesterPrincipalFor(request) !== null;
}
