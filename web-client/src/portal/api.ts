import type {
  PortalAttachment,
  PortalKbSearchItem,
  PortalNote,
  PortalRequesterDto,
  PortalTicket,
  PortalTicketPage,
} from "./types";

export class PortalApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PortalApiError";
    this.status = status;
  }
}

async function portalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new PortalApiError(response.status, `Portal request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function isPortalAuthError(error: unknown): boolean {
  return error instanceof PortalApiError && (error.status === 401 || error.status === 403);
}

export function requestMagicLink(email: string) {
  return portalRequest<{ ok: true; message: string }>("/portal/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyMagicLink(token: string) {
  return portalRequest<{ requester: PortalRequesterDto }>("/portal/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function getPortalRequester() {
  return portalRequest<{ requester: PortalRequesterDto }>("/portal/auth/me");
}

export function logoutPortal() {
  return portalRequest<{ ok: true }>("/portal/auth/logout", { method: "POST" });
}

export function listPortalTickets(page: number, pageSize: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  return portalRequest<PortalTicketPage>(`/portal/tickets?${params}`);
}

export function getPortalTicket(ticketId: number) {
  return portalRequest<PortalTicket>(`/portal/tickets/${ticketId}`);
}

export function createPortalTicket(input: { summary: string; description: string }) {
  return portalRequest<PortalTicket>("/portal/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addPortalComment(ticketId: number, content: string) {
  return portalRequest<PortalNote>(`/portal/tickets/${ticketId}/comments`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function uploadPortalAttachments(ticketId: number, files: File[]) {
  const body = new FormData();
  files.forEach((file) => body.append("file", file, file.name));
  return portalRequest<PortalAttachment[]>(`/portal/tickets/${ticketId}/attachments`, {
    method: "POST",
    body,
  });
}

/**
 * The KB ships independently. Its absence or failure is an expected state for
 * the portal, so this one read deliberately returns null on every failure and
 * never logs or throws into the ticket form.
 */
export async function searchPortalKnowledgeBase(
  query: string,
  signal?: AbortSignal,
): Promise<PortalKbSearchItem[] | null> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("visibility", "portal");
  params.set("limit", "5");

  try {
    const response = await fetch(`/api/kb/search?${params}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) return null;
    const valid = body.items.every((item): item is PortalKbSearchItem => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.id === "number"
        && Number.isSafeInteger(candidate.id)
        && typeof candidate.slug === "string"
        && typeof candidate.title === "string"
        && typeof candidate.excerpt === "string"
        && typeof candidate.score === "number"
        && Number.isFinite(candidate.score)
      );
    });
    return valid ? body.items.slice(0, 5) : null;
  } catch {
    return null;
  }
}
