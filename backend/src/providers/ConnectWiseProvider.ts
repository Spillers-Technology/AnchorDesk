/**
 * ConnectWise Manage implementation of TicketProvider.
 *
 * Wraps the connectwise-rest client and normalizes CW-specific shapes into
 * the generic ExternalTicket / ExternalNote types the sync service expects.
 * The rest of the system has no knowledge of CW API details.
 */

import { createCwm } from "../services/connectwiseService";
import { ConditionBuilder } from "../services/conditionBuilder";
import { SyncFilter } from "../services/syncFilter";
import {
  TicketProvider,
  ExternalTicket,
  ExternalNote,
  TicketWriteback,
} from "./TicketProvider";

/** ConnectWise defaults to 1,000 records per page. Bound the crawl so a broken
 *  or unexpectedly unbounded remote cannot hold a sync worker forever. Only an
 *  empty cursor page proves completion: a server may clamp the requested page
 *  size, so treating a short non-empty page as final can silently return a
 *  prefix and let the caller advance its incremental watermark past it. */
export const CONNECTWISE_PAGE_SIZE = 1000;
export const CONNECTWISE_MAX_PAGES = 100;

/**
 * ConnectWise sync must always be bounded to an explicitly named board. A
 * hidden tenant default is unsafe for a public product, while treating blank
 * as "all boards" can silently widen a job after an edit or migration.
 */
export function requireConnectWiseBoard(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      "ConnectWise sync requires an explicit nonblank board name",
    );
  }
  return value.trim();
}

function parseRecordId(label: string, page: number, value: unknown): number {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(
      `ConnectWise ${label} page ${page} contained a record with an invalid id`,
    );
  }
  return id;
}

async function fetchAllById(
  label: string,
  fetchPage: (lastSeenId?: number) => Promise<unknown>,
): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  let lastSeenId: number | undefined;

  for (let page = 1; page <= CONNECTWISE_MAX_PAGES; page++) {
    const raw = await fetchPage(lastSeenId);
    if (!Array.isArray(raw)) {
      throw new Error(
        `ConnectWise ${label} page ${page} returned a non-array response`,
      );
    }
    if (raw.length > CONNECTWISE_PAGE_SIZE) {
      throw new Error(
        `ConnectWise ${label} page ${page} returned ${raw.length} records, exceeding the requested page size`,
      );
    }

    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(
          `ConnectWise ${label} page ${page} contained an invalid record`,
        );
      }
      const record = item as Record<string, unknown>;
      const id = parseRecordId(label, page, record["id"]);
      if (lastSeenId !== undefined && id <= lastSeenId) {
        throw new Error(
          `ConnectWise ${label} page ${page} id ${id} did not advance past cursor ${lastSeenId}`,
        );
      }
      records.push(record);
      lastSeenId = id;
    }

    if (raw.length === 0) return records;
  }

  throw new Error(
    `ConnectWise ${label} pagination reached the safety cap of ${CONNECTWISE_MAX_PAGES} pages ` +
      "(all non-empty); refusing partial results",
  );
}

function withIdCursor(
  baseConditions: string | undefined,
  lastSeenId?: number,
): string | undefined {
  if (lastSeenId === undefined) return baseConditions;
  const cursorCondition = `id > ${lastSeenId}`;
  return baseConditions
    ? `${baseConditions} AND ${cursorCondition}`
    : cursorCondition;
}

/** ConnectWise caps a ticket summary at 100 characters. */
const CW_SUMMARY_MAX = 100;

const cwQuote = (v: string) => `"${v.replace(/"/g, '\\"')}"`;

/**
 * Fold the provider-neutral filter into ConnectWise conditions for the first
 * run. Only includes are pushed down: an include is a superset of what the
 * local predicate keeps, while a pushed-down exclude would also have to re-admit
 * empty fields and multi-resource tickets exactly as `matches()` does — get that
 * wrong and tickets are dropped remotely where nothing can recover them. The
 * name-based assignee clause stays local too (CW's `resources` holds member
 * identifiers, not names).
 *
 * A technician matches as the ticket owner or as any listed resource.
 * `resources contains "jo"` also matches "joe"; that is fine — push-down may be
 * wider, the local predicate compares exactly.
 */
export function connectWiseFilterConditions(filter: SyncFilter | null | undefined): string[] {
  if (!filter) return [];
  const clauses: string[] = [];
  const inList = (field: string, values?: string[]) => {
    if (values?.length) clauses.push(`${field} in (${values.map(cwQuote).join(",")})`);
  };
  inList("status/name", filter.status);
  inList("priority/name", filter.priority);
  inList("company/name", filter.companyName);
  if (filter.assigneeId?.length) {
    const people = [
      `owner/identifier in (${filter.assigneeId.map(cwQuote).join(",")})`,
      ...filter.assigneeId.map((id) => `resources contains ${cwQuote(id)}`),
    ];
    clauses.push(`(${people.join(" OR ")})`);
  }
  return clauses;
}

/** Filter clauses this provider enforces only after the fetch. */
function connectWiseLocalOnly(filter: SyncFilter | null | undefined): string[] {
  if (!filter) return [];
  const out: string[] = [];
  if (filter.assignee?.length) out.push("assignee (by name)");
  const ex = filter.exclude ?? {};
  for (const [field, values] of Object.entries(ex)) {
    if (values?.length) out.push(`excluded ${field}`);
  }
  return out;
}

export class ConnectWiseProvider implements TicketProvider {
  readonly name = "connectwise";
  readonly canWriteBack = true;
  // CW patches status/priority/assignee only — see updateTicket below.
  readonly writableFields = ["status", "priority", "assignee"] as const;

  private readonly board: string;
  /** One credential/client snapshot for the complete account-locked operation. */
  private readonly cwm: ReturnType<typeof createCwm>;
  private readonly filter: SyncFilter | null;
  /** Company identifier used when creating a ticket whose company has no exact CW match. */
  private readonly createCompany: string | null;

  constructor(
    board: string,
    credentials?: Record<string, unknown>,
    filter?: SyncFilter | null,
    options: { createCompany?: string | null } = {},
  ) {
    this.board = requireConnectWiseBoard(board);
    this.cwm = createCwm(credentials);
    this.filter = filter ?? null;
    this.createCompany = options.createCompany?.trim() || null;
  }

  /** The job's base scope: its board, top-level tickets only. */
  private baseConditions(): ConditionBuilder {
    return new ConditionBuilder()
      .addCondition("board/name", "=", this.board)
      .addCondition("parentTicketId", "=", null);
  }

  /** Base scope narrowed by the filter's pushed-down includes (first run only). */
  private firstRunConditions(): string {
    const cb = this.baseConditions();
    for (const clause of connectWiseFilterConditions(this.filter)) cb.addGroup(clause);
    return cb.build();
  }

  async previewFirstRun(): Promise<{ count: number; approximate: boolean; localOnly: string[] }> {
    const res = await this.cwm.ServiceAPI.getServiceTicketsCount({ conditions: this.firstRunConditions() });
    const count = Number((res as { count?: number })?.count);
    if (!Number.isFinite(count)) throw new Error("ConnectWise did not return a ticket count");
    return { count, approximate: false, localOnly: connectWiseLocalOnly(this.filter) };
  }

  createBlocker(): string | null {
    return null;
  }

  /**
   * Create a service ticket on this job's board. ConnectWise requires a
   * company: the ticket's company is matched by exact name, else the job's
   * `createCompany` identifier is used, else creation fails with a message that
   * says how to fix it — never a guess.
   */
  async pushTicket(ticket: { title: string; description?: string; companyName?: string }): Promise<string> {
    let company: { id?: number; identifier?: string } | null = null;
    if (ticket.companyName?.trim()) {
      const hits = await this.cwm.CompanyAPI.getCompanyCompanies({
        conditions: `name = ${cwQuote(ticket.companyName.trim())} AND deletedFlag = false`,
        pageSize: 2,
      });
      if (Array.isArray(hits) && hits.length === 1 && hits[0]?.id) company = { id: hits[0].id };
      else if (Array.isArray(hits) && hits.length > 1) {
        throw new Error(`more than one ConnectWise company is named "${ticket.companyName}"; set a default company on the sync job or rename one`);
      }
    }
    if (!company && this.createCompany) company = { identifier: this.createCompany };
    if (!company) {
      throw new Error(
        ticket.companyName
          ? `no ConnectWise company is named "${ticket.companyName}"; set a default company identifier on the sync job`
          : "the ticket has no company; set a default company identifier on the sync job",
      );
    }
    const summary = ticket.title.replace(/\s+/g, " ").trim() || "(no subject)";
    const created = await this.cwm.ServiceAPI.postServiceTickets({
      summary: summary.length > CW_SUMMARY_MAX ? `${summary.slice(0, CW_SUMMARY_MAX - 1)}…` : summary,
      initialDescription: ticket.description ?? undefined,
      board: { name: this.board },
      company,
    } as Parameters<typeof this.cwm.ServiceAPI.postServiceTickets>[0]);
    const id = (created as { id?: number })?.id;
    if (!id) throw new Error("ConnectWise created the ticket but returned no id");
    return String(id);
  }

  async getTicket(externalTicketId: string): Promise<ExternalTicket | null> {
    try {
      const raw = await this.cwm.ServiceAPI.getServiceTicketsById(
        parseInt(externalTicketId),
      );
      return raw ? this.normalizeTicket(raw as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /**
   * Push status/priority/assignee back to CW via JSON-Patch. Only fields present
   * in `changes` are patched, and only to well-known reference paths so a bad
   * field can't reject the whole operation. Status/priority are CW *references*
   * matched by name; assignee maps to the ticket's `resources` string.
   */
  async updateTicket(
    externalTicketId: string,
    changes: TicketWriteback,
  ): Promise<void> {
    const ops: Array<{ op: "replace"; path: string; value: unknown }> = [];
    if (changes.status)
      ops.push({ op: "replace", path: "status/name", value: changes.status });
    if (changes.priority)
      ops.push({
        op: "replace",
        path: "priority/name",
        value: changes.priority,
      });
    if (changes.assignee)
      ops.push({ op: "replace", path: "resources", value: changes.assignee });
    if (ops.length === 0) return;
    // The client types patch `value` as an object map, but CW accepts scalar
    // replaces (status/name → "In Progress"); bridge the type at the call site.
    await this.cwm.ServiceAPI.patchServiceTicketsById(
      parseInt(externalTicketId),
      ops as unknown as {
        op: string;
        path: string;
        value: Record<string, unknown>;
      }[],
    );
  }

  async pushNote(
    externalTicketId: string,
    note: { content: string; author: string },
  ): Promise<string> {
    const created = await this.cwm.ServiceAPI.postServiceTicketsByParentIdNotes(
      parseInt(externalTicketId),
      {
        text: note.content,
        detailDescriptionFlag: true,
        internalAnalysisFlag: false,
      } as Record<string, unknown>,
    );
    return String((created as Record<string, unknown>)?.["id"] ?? "");
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    // The filter narrows discovery on the first run only. Incremental runs use
    // the unfiltered board scope so an owned ticket that moves out of the
    // filter is still returned, and the sync service can stop syncing it
    // visibly instead of silently losing track of it.
    let conditions: string;
    if (since) {
      conditions = this.baseConditions().addCondition("_info/lastUpdated", ">", since).build();
    } else {
      conditions = this.firstRunConditions();
    }

    const raw = await fetchAllById("tickets", (lastSeenId) =>
      this.cwm.ServiceAPI.getServiceTickets({
        conditions: withIdCursor(conditions, lastSeenId),
        orderBy: "id asc",
        page: 1,
        pageSize: CONNECTWISE_PAGE_SIZE,
      }),
    );
    return (raw as Record<string, unknown>[]).map((t) =>
      this.normalizeTicket(t),
    );
  }

  async fetchNotes(externalTicketId: string): Promise<ExternalNote[]> {
    const ticketId = parseInt(externalTicketId);
    const raw = await fetchAllById(
      `notes for ticket ${externalTicketId}`,
      (lastSeenId) =>
        this.cwm.ServiceAPI.getServiceTicketsByParentIdNotes(ticketId, {
          conditions: withIdCursor(undefined, lastSeenId),
          orderBy: "id asc",
          page: 1,
          pageSize: CONNECTWISE_PAGE_SIZE,
        }),
    );
    return (raw as Record<string, unknown>[]).map((n) => this.normalizeNote(n));
  }

  private normalizeTicket(t: Record<string, unknown>): ExternalTicket {
    const company = t["company"] as Record<string, unknown> | undefined;
    const status = t["status"] as Record<string, unknown> | undefined;
    const priority = t["priority"] as Record<string, unknown> | undefined;
    const info = t["_info"] as Record<string, unknown> | undefined;
    const lastUpdated = info?.["lastUpdated"];

    return {
      externalId: String(t["id"]),
      ticketNumber: String(t["id"]),
      title: String(t["summary"] ?? ""),
      summary: String(t["summary"] ?? ""),
      description: String(t["initialDescription"] ?? ""),
      status: String(status?.["name"] ?? "New"),
      priority: String(priority?.["name"] ?? ""),
      companyName: String(company?.["name"] ?? ""),
      assignee: String(t["resources"] ?? ""),
      ...connectWisePeople(t),
      updatedAt: lastUpdated ? new Date(String(lastUpdated)) : undefined,
    };
  }

  private normalizeNote(n: Record<string, unknown>): ExternalNote {
    const member = n["member"] as Record<string, unknown> | undefined;
    const isTimeEntry = Boolean(n["timeStart"]);
    const isExplicitlyPublic =
      !isTimeEntry &&
      n["detailDescriptionFlag"] === true &&
      n["internalAnalysisFlag"] === false &&
      n["internalFlag"] !== true;

    return {
      externalId: String(n["id"]),
      content: String(n["text"] ?? ""),
      author: member
        ? `${member["firstName"]} ${member["lastName"]}`
        : "Unknown",
      noteType: isTimeEntry ? "time_entry" : "note",
      // Only an explicitly external detail note is safe for a requester.
      // Missing, contradictory, internal-analysis, and time shapes fail closed.
      visibility: isExplicitlyPublic ? "public" : "internal",
      timeStart: n["timeStart"]
        ? new Date(n["timeStart"] as string)
        : undefined,
      timeStop: n["timeEnd"] ? new Date(n["timeEnd"] as string) : undefined,
      createdAt: n["_info"]
        ? new Date(
            (n["_info"] as Record<string, unknown>)["dateCreated"] as string,
          )
        : undefined,
    };
  }
}

/**
 * Everyone on a CW ticket: the owner plus each member identifier in the
 * comma-joined `resources` string. Identifiers are what the member picker stores
 * and what `resources` contains; the owner's display name is added to the names
 * so a legacy name filter can match the owner too.
 */
export function connectWisePeople(t: Record<string, unknown>): { assigneeIds: string[]; assigneeNames: string[] } {
  const owner = t["owner"] as Record<string, unknown> | undefined;
  const resources = String(t["resources"] ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  const ids = [...(owner?.["identifier"] ? [String(owner["identifier"])] : []), ...resources];
  const names = [...(owner?.["name"] ? [String(owner["name"])] : []), ...resources];
  const unique = (list: string[]) => [...new Map(list.map((v) => [v.toLowerCase(), v])).values()];
  return { assigneeIds: unique(ids), assigneeNames: unique(names) };
}
