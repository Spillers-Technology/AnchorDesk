/**
 * ConnectWise Manage implementation of TicketProvider.
 *
 * Wraps the connectwise-rest client and normalizes CW-specific shapes into
 * the generic ExternalTicket / ExternalNote types the sync service expects.
 * The rest of the system has no knowledge of CW API details.
 */

import { getCwm } from '../services/connectwiseService';
import { ConditionBuilder } from '../services/conditionBuilder';
import { TicketProvider, ExternalTicket, ExternalNote, TicketWriteback } from './TicketProvider';

export class ConnectWiseProvider implements TicketProvider {
  readonly name = 'connectwise';
  readonly canWriteBack = true;

  private readonly board: string;

  constructor(board = 'SMB Services - SMB Team 1 Support') {
    this.board = board;
  }

  async getTicket(externalTicketId: string): Promise<ExternalTicket | null> {
    try {
      const raw = await getCwm().ServiceAPI.getServiceTicketsById(parseInt(externalTicketId));
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
  async updateTicket(externalTicketId: string, changes: TicketWriteback): Promise<void> {
    const ops: Array<{ op: 'replace'; path: string; value: unknown }> = [];
    if (changes.status) ops.push({ op: 'replace', path: 'status/name', value: changes.status });
    if (changes.priority) ops.push({ op: 'replace', path: 'priority/name', value: changes.priority });
    if (changes.assignee) ops.push({ op: 'replace', path: 'resources', value: changes.assignee });
    if (ops.length === 0) return;
    // The client types patch `value` as an object map, but CW accepts scalar
    // replaces (status/name → "In Progress"); bridge the type at the call site.
    await getCwm().ServiceAPI.patchServiceTicketsById(
      parseInt(externalTicketId),
      ops as unknown as { op: string; path: string; value: Record<string, unknown> }[]
    );
  }

  async pushNote(externalTicketId: string, note: { content: string; author: string }): Promise<string> {
    const created = await getCwm().ServiceAPI.postServiceTicketsByParentIdNotes(parseInt(externalTicketId), {
      text: note.content,
      detailDescriptionFlag: true,
      internalAnalysisFlag: false,
    } as Record<string, unknown>);
    return String((created as Record<string, unknown>)?.['id'] ?? '');
  }

  async fetchTickets(since?: Date): Promise<ExternalTicket[]> {
    const cb = new ConditionBuilder()
      .addCondition('board/name', '=', this.board)
      .addNotInCondition('status/name', ['Closed', 'Admin Closed', 'Complete', 'Canceled', 'Closed/No Response'])
      .addCondition('parentTicketId', '=', null);

    if (since) {
      cb.addCondition('_info/lastUpdated', '>', since);
    }

    const raw = await getCwm().ServiceAPI.getServiceTickets({ conditions: cb.build(), page: 1, pageSize: 1000 });
    return (raw as Record<string, unknown>[]).map((t) => this.normalizeTicket(t));
  }

  async fetchNotes(externalTicketId: string): Promise<ExternalNote[]> {
    const raw = await getCwm().ServiceAPI.getServiceTicketsByParentIdNotes(parseInt(externalTicketId), {
      page: 1,
      pageSize: 1000,
    });
    return (raw as Record<string, unknown>[]).map((n) => this.normalizeNote(n));
  }

  private normalizeTicket(t: Record<string, unknown>): ExternalTicket {
    const company = t['company'] as Record<string, unknown> | undefined;
    const status = t['status'] as Record<string, unknown> | undefined;
    const priority = t['priority'] as Record<string, unknown> | undefined;
    const info = t['_info'] as Record<string, unknown> | undefined;
    const lastUpdated = info?.['lastUpdated'];

    return {
      externalId: String(t['id']),
      ticketNumber: String(t['id']),
      title: String(t['summary'] ?? ''),
      summary: String(t['summary'] ?? ''),
      description: String(t['initialDescription'] ?? ''),
      status: String(status?.['name'] ?? 'New'),
      priority: String(priority?.['name'] ?? ''),
      companyName: String(company?.['name'] ?? ''),
      assignee: String(t['resources'] ?? ''),
      updatedAt: lastUpdated ? new Date(String(lastUpdated)) : undefined,
    };
  }

  private normalizeNote(n: Record<string, unknown>): ExternalNote {
    const member = n['member'] as Record<string, unknown> | undefined;
    const isTimeEntry = Boolean(n['timeStart']);

    return {
      externalId: String(n['id']),
      content: String(n['text'] ?? ''),
      author: member ? `${member['firstName']} ${member['lastName']}` : 'Unknown',
      noteType: isTimeEntry ? 'time_entry' : 'note',
      timeStart: n['timeStart'] ? new Date(n['timeStart'] as string) : undefined,
      timeStop: n['timeEnd'] ? new Date(n['timeEnd'] as string) : undefined,
      createdAt: n['_info'] ? new Date((n['_info'] as Record<string, unknown>)['dateCreated'] as string) : undefined,
    };
  }
}
