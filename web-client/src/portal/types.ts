/**
 * Requester-facing DTOs.
 *
 * These types intentionally do not extend or import the staff User, Ticket,
 * Note, or Attachment shapes. The portal is a separate principal and a
 * separate serialization boundary.
 */

export interface PortalRequesterDto {
  displayName: string;
  email: string;
}

export interface PortalRequesterPrincipal extends PortalRequesterDto {
  readonly kind: "requester";
}

/** Feature gates included with the authenticated requester bootstrap. */
export interface PortalClientConfig {
  feedbackEnabled: boolean;
  promptOnSolve: boolean;
  allowSelfSolve: boolean;
}

export interface PortalNote {
  id: number;
  content: string;
  htmlContent: string | null;
  direction: string | null;
  authorKind: "you" | "support";
  authorName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
}

export interface PortalAttachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  downloadUrl: string;
}

export interface PortalTicket {
  id: number;
  ticketNumber: string | null;
  title: string;
  summary: string;
  description: string | null;
  status: string;
  priority: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  notes: PortalNote[];
  attachments: PortalAttachment[];
}

export interface PortalTicketPage {
  items: PortalTicket[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalKbSearchItem {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  score: number;
}
