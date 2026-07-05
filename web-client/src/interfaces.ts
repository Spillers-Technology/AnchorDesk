export interface TimeEntry {
  TimeEntryID: number;
  TimeStart: string;
  TimeStop: string;
  TimeNote: string;
  Technician: Technician | null;
}

export interface Technician {
  TechnicianID: number;
  FirstName: string;
  LastName: string;
  Username: string;
}

export interface Company {
  CompanyName: string;
  Acronym: string;
  PrimaryEngagementMgr: string;
}

export interface Note {
  id: string;
  dateCreated: string;
  text: string;
  authorId: string;
  authorName: string;
  type: "note" | "timeEntry" | "email";
  timeStart?: string;
  timeStop?: string;
  minutes?: number;
  // Email correspondence metadata (type === "email").
  direction?: "inbound" | "outbound";
  html?: string;
  emailFrom?: string;
  emailTo?: string;
  emailCc?: string;
  subject?: string;
}

export interface Ticket {
  status: string;
  /** Human-friendly public ticket number (distinct from the local database ID). */
  ticketnumber: string;
  /** Local database row ID — use this for all API calls. */
  localId?: number;
  company: Company;
  ticketSummary: string;
  ticketTitle: string;
  assignee?: string;
  technician: Technician | null;
  priority: string;
  timeEntries: TimeEntry[];
  dateEntered: string;
  // SLA deadlines (1.7.0) — drive the live SLA chip on lists/cards/board.
  responseDueAt?: string | null;
  resolutionDueAt?: string | null;
  firstRespondedAt?: string | null;
  source?: string;
  externalProvider?: string;
  externalId?: string;
  // Two-way sync state for external tickets (null/undefined for local ones).
  syncState?: "synced" | "pending" | "conflict" | "error" | null;
  syncedAt?: string | null;
  // Labels (1.8.0) — managed tags, e.g. which mailbox a ticket arrived on.
  labels?: { label: { id: number; name: string; color: string } }[];
}
