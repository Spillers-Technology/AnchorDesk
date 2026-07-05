/**
 * TicketProvider — Strategy interface for external ticket sources.
 *
 * Implement this interface to add a new sync source (ConnectWise, IMAP, etc.).
 * The sync service calls these methods; it does not know or care which provider
 * it is talking to. See ConnectWiseProvider.ts for the reference implementation.
 *
 * GoF pattern: Strategy
 */

export interface ExternalTicket {
  externalId: string;
  ticketNumber?: string;
  title: string;
  summary?: string;
  description?: string;
  status: string;
  priority?: string;
  companyName?: string;
  assignee?: string;
  /** Remote's own last-updated stamp, used for conflict detection. */
  updatedAt?: Date;
}

/** The subset of fields two-way sync pushes back to the external system. */
export interface TicketWriteback {
  status?: string;
  priority?: string;
  assignee?: string;
}

export interface ExternalNote {
  externalId: string;
  content: string;
  author: string;
  noteType: 'note' | 'time_entry';
  timeStart?: Date;
  timeStop?: Date;
  createdAt?: Date;
}

export interface TicketProvider {
  /** Human-readable name used in sync_log records. */
  readonly name: string;

  /** Whether this provider supports writing local changes back out (two-way).
   *  When true it must implement getTicket, updateTicket, and pushNote. */
  readonly canWriteBack?: boolean;

  /** Fetch tickets modified since `since`, or all tickets if omitted. */
  fetchTickets(since?: Date): Promise<ExternalTicket[]>;

  /** Fetch a single ticket by external id — used by two-way reconcile to read
   *  the current remote state. Optional (write-back providers must implement). */
  getTicket?(externalTicketId: string): Promise<ExternalTicket | null>;

  /** Fetch notes for a single ticket by its external ID. */
  fetchNotes(externalTicketId: string): Promise<ExternalNote[]>;

  /** Push a local ticket to the external system. Returns the external ID.
   *  Optional — outbound sync is not required for all providers. */
  pushTicket?(ticket: { title: string; description?: string; companyName?: string }): Promise<string>;

  /** Push field changes (status/priority/assignee) to the external system. */
  updateTicket?(externalTicketId: string, changes: TicketWriteback): Promise<void>;

  /** Push a note to the external system. Returns the remote note id if the API
   *  provides one (so we can mark the local note as synced). */
  pushNote?(externalTicketId: string, note: { content: string; author: string }): Promise<string | void>;
}
