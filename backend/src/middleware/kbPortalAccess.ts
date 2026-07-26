/**
 * Workstream C integration seam for portal knowledge-base reads.
 *
 * Portal sessions do not exist on this branch yet. V1 therefore treats
 * published `portal` articles as anonymously readable, which is consistent
 * with their intended audience. When the portal principal lands, wire its
 * session verification in this one function; the KB routes and repository
 * visibility boundary do not need to change.
 */
import type { FastifyRequest } from 'fastify';

export function isPortalKbReadRequest(request: Pick<FastifyRequest, 'method' | 'url'>): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  try {
    const url = new URL(request.url, 'http://anchordesk.local');
    if (url.pathname === '/kb/search') {
      const visibility = url.searchParams.getAll('visibility');
      return visibility.length === 1 && visibility[0] === 'portal';
    }
    return /^\/kb\/portal\/[^/]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function authorizePortalKbRead(
  request: Pick<FastifyRequest, 'method' | 'url'>,
): Promise<boolean> {
  if (!isPortalKbReadRequest(request)) return false;

  // PORTAL PRINCIPAL SEAM (Workstream C):
  // Replace this `true` with portal-session resolution/authorization when the
  // Contact-backed principal is merged. Do not move visibility decisions here:
  // the called repository methods remain hard-coded to published+portal.
  return true;
}
