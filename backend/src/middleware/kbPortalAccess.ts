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
import { isPortalEnabled } from '../services/settingsService';

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

  // The portal switch is the authorization. While it is off — the default —
  // these reads require ordinary staff auth like everything else, so upgrading
  // never turns AnchorDesk's first anonymous data-returning endpoint on by
  // itself. While it is on, the shop has decided to publish a customer-facing
  // portal, and published `portal`-visibility articles are exactly the content
  // that decision covers.
  //
  // Visibility is NOT decided here: the repository functions this reaches are
  // hard-coded to deleted_at IS NULL AND published AND visibility = 'portal',
  // and re-check that before serializing. This gate only answers "may anyone
  // ask?", never "what may they see?".
  return isPortalEnabled();
}
