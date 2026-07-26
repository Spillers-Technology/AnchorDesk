/**
 * ConnectWise Manage implementation of TicketProvider.
 *
 * Wraps the connectwise-rest client and normalizes CW-specific shapes into
 * the generic ExternalTicket / ExternalNote types the sync service expects.
 * The rest of the system has no knowledge of CW API details.
 */

import { createCwm } from "../services/connectwiseService";
import { ConditionBuilder } from "../services/conditionBuilder";
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

export class ConnectWiseProvider implements TicketProvider {
  readonly name = "connectwise";
  readonly canWriteBack = true;
  // CW patches status/priority/assignee only — see updateTicket below.
  readonly writableFields = ["status", "priority", "assignee"] as const;

  private readonly board: string;
  /** One credential/client snapshot for the complete account-locked operation. */
  private readonly cwm: ReturnType<typeof createCwm>;

  constructor(board: string, credentials?: Record<string, unknown>) {
    this.board = requireConnectWiseBoard(board);
    this.cwm = createCwm(credentials);
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
    const cb = new ConditionBuilder()
      .addCondition("board/name", "=", this.board)
      .addCondition("parentTicketId", "=", null);

    if (since) {
      cb.addCondition("_info/lastUpdated", ">", since);
    }

    const conditions = cb.build();
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
