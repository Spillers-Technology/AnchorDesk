/**
 * syncFilter — one filtering vocabulary shared by every ticket sync provider.
 *
 * The problem this solves: "only pull tickets whose primary resource is Joe"
 * is a question every PSA/ITSM can answer, but each spells it differently
 * (ConnectWise `resources`, Jira `assignee`, and so on). Rather than teaching
 * each provider its own filter shape, a provider row carries one neutral filter
 * and every provider is measured against it.
 *
 * Two-layer design, deliberately:
 *
 *  1. **Push-down (optional, per provider).** A provider may translate whatever
 *     subset it understands into its native query so the remote does the work
 *     and the response stays small. Push-down must be a *superset* of what the
 *     local predicate accepts: anything dropped remotely can never be recovered.
 *  2. **Local predicate (always).** `matches()` is applied to every fetched
 *     ticket regardless. A provider that pushes nothing down still filters
 *     correctly, and a push-down that is subtly wider than intended cannot leak
 *     tickets past the filter. Correctness lives here; push-down is only an
 *     optimization.
 *
 * Matching rules: a filter with no clauses matches everything. Within a field,
 * values are OR'd; across fields they are AND'd. Comparison is
 * case-insensitive and whitespace-trimmed, because external systems are
 * inconsistent about both. `exclude` is applied after `include` and wins.
 *
 * People. A ticket can have several people on it (ConnectWise's owner plus every
 * member in `resources`). `assigneeId` matches the remote's stable identity —
 * Jira accountId, ConnectWise member identifier — and matches when ANY person
 * on the ticket is listed; an exclude rejects when any listed person is on it.
 * `assignee` is the older display-name match, kept for existing jobs.
 */

/** Ticket fields that can be filtered on. Provider-neutral by design. */
export const FILTERABLE_FIELDS = ['assignee', 'assigneeId', 'status', 'priority', 'companyName'] as const;
export type FilterableField = (typeof FILTERABLE_FIELDS)[number];

export type SyncFilter = Partial<Record<FilterableField, string[]>> & {
  exclude?: Partial<Record<FilterableField, string[]>>;
  /**
   * Display names for the IDs in `assigneeId`, as picked in the editor. For
   * rendering and explanations only — never consulted when matching, so a
   * renamed person still matches by ID.
   */
  labels?: Record<string, string>;
};

/** The subset of an external ticket a filter can see. */
export type FilterableTicket = Partial<Record<Exclude<FilterableField, 'assigneeId'>, string | undefined>> & {
  /** Every remote identity on the ticket (owner, resources, assignee). */
  assigneeIds?: string[];
  /** Every display name on the ticket, when there can be more than one. */
  assigneeNames?: string[];
};

const norm = (v: string | undefined): string => (v ?? '').trim().toLowerCase();

/** The values a ticket presents for one field. Never empty: "unset" is ''. */
function valuesOf(ticket: FilterableTicket, field: FilterableField): string[] {
  let values: (string | undefined)[];
  if (field === 'assigneeId') values = ticket.assigneeIds ?? [];
  else if (field === 'assignee') values = ticket.assigneeNames?.length ? ticket.assigneeNames : [ticket.assignee];
  else values = [ticket[field]];
  const normalized = values.map(norm).filter((v, i, all) => v !== '' || all.length === 1);
  return normalized.length ? normalized : [''];
}

function anyListed(listed: string[], actual: string[]): boolean {
  const wanted = new Set(listed.map(norm));
  return actual.some((a) => wanted.has(a));
}

/** True when the ticket satisfies the filter. An empty filter matches everything. */
export function matches(ticket: FilterableTicket, filter?: SyncFilter | null): boolean {
  return explainMismatch(ticket, filter) === null;
}

/**
 * Why a ticket fails the filter, in words a technician can act on, or null if
 * it matches. Used for the reason shown when a ticket stops syncing.
 */
export function explainMismatch(ticket: FilterableTicket, filter?: SyncFilter | null): string | null {
  if (!filter) return null;
  const name = (id: string) => filter.labels?.[id] ?? id;
  const shown = (field: FilterableField, values: string[]) =>
    (field === 'assigneeId' ? values.map(name) : values).join(', ');
  const current = (field: FilterableField) => {
    if (field === 'assigneeId') {
      const ids = ticket.assigneeIds ?? [];
      return ids.length ? ids.map(name).join(', ') : 'nobody';
    }
    if (field === 'assignee') {
      const names = ticket.assigneeNames?.length ? ticket.assigneeNames : [ticket.assignee];
      return names.filter(Boolean).join(', ') || 'nobody';
    }
    return ticket[field] || 'empty';
  };

  // People read as a sentence about the ticket ("it's assigned to “Bob”"),
  // other fields as a field value ("status is “Closed”").
  const describe = (field: FilterableField) => {
    if (field === 'assigneeId' || field === 'assignee') {
      const who = current(field);
      return who === 'nobody' ? "it's unassigned" : `it's assigned to ${quote(who)}`;
    }
    return `${FIELD_WORDS[field]} is ${quote(current(field))}`;
  };

  for (const field of FILTERABLE_FIELDS) {
    const listed = filter[field];
    if (!listed || listed.length === 0) continue;
    if (!anyListed(listed, valuesOf(ticket, field))) {
      return `${describe(field)}; this job only syncs ${field === 'assigneeId' || field === 'assignee' ? '' : `${FIELD_WORDS[field]} `}${shown(field, listed)}`;
    }
  }

  const excl = filter.exclude;
  if (excl) {
    for (const field of FILTERABLE_FIELDS) {
      const listed = excl[field];
      if (!listed || listed.length === 0) continue;
      const actual = valuesOf(ticket, field).filter((v) => v !== '');
      if (anyListed(listed, actual)) {
        return field === 'assigneeId' || field === 'assignee'
          ? `${describe(field)}, whom this job excludes`
          : `${describe(field)}, which this job excludes`;
      }
    }
  }

  return null;
}

const FIELD_WORDS: Record<FilterableField, string> = {
  assignee: 'assignee',
  assigneeId: 'assignee',
  status: 'status',
  priority: 'priority',
  companyName: 'company',
};

const quote = (s: string) => `“${s}”`;

/**
 * Validate and normalize a filter coming off the wire (provider config JSON).
 * Returns null for "no filter". Throws on a shape that would silently misfilter
 * — a typo'd field name must not quietly widen the sync.
 */
export function parseSyncFilter(raw: unknown): SyncFilter | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('filter must be an object');
  }

  const out: SyncFilter = {};
  const src = raw as Record<string, unknown>;

  const readList = (value: unknown, where: string): string[] => {
    if (!Array.isArray(value)) throw new Error(`filter.${where} must be an array of strings`);
    const list = value.map((v) => {
      if (typeof v !== 'string') throw new Error(`filter.${where} must contain only strings`);
      return v.trim();
    });
    return list.filter((v) => v.length > 0);
  };

  for (const [key, value] of Object.entries(src)) {
    if (key === 'exclude' || key === 'labels') continue;
    if (!FILTERABLE_FIELDS.includes(key as FilterableField)) {
      throw new Error(`unknown filter field "${key}" (allowed: ${FILTERABLE_FIELDS.join(', ')})`);
    }
    const list = readList(value, key);
    if (list.length) out[key as FilterableField] = list;
  }

  if (src.exclude != null) {
    if (typeof src.exclude !== 'object' || Array.isArray(src.exclude)) {
      throw new Error('filter.exclude must be an object');
    }
    const exclude: Partial<Record<FilterableField, string[]>> = {};
    for (const [key, value] of Object.entries(src.exclude as Record<string, unknown>)) {
      if (!FILTERABLE_FIELDS.includes(key as FilterableField)) {
        throw new Error(`unknown filter field "exclude.${key}" (allowed: ${FILTERABLE_FIELDS.join(', ')})`);
      }
      const list = readList(value, `exclude.${key}`);
      if (list.length) exclude[key as FilterableField] = list;
    }
    if (Object.keys(exclude).length) out.exclude = exclude;
  }

  const hasClauses = Object.keys(out).length > 0;

  if (src.labels != null) {
    if (typeof src.labels !== 'object' || Array.isArray(src.labels)) {
      throw new Error('filter.labels must be an object of id → display name');
    }
    const labels: Record<string, string> = {};
    for (const [id, label] of Object.entries(src.labels as Record<string, unknown>)) {
      if (typeof label !== 'string') throw new Error('filter.labels values must be strings');
      if (id.trim() && label.trim()) labels[id.trim()] = label.trim();
    }
    // Labels alone are not a filter: they only name IDs a clause uses.
    if (hasClauses && Object.keys(labels).length) out.labels = labels;
  }

  return hasClauses ? out : null;
}

/** Human-readable one-liner for logs and the Sync view. */
export function describeSyncFilter(filter?: SyncFilter | null): string {
  if (!filter) return 'no filter (all tickets)';
  const name = (field: FilterableField, v: string[]) =>
    (field === 'assigneeId' ? v.map((id) => filter.labels?.[id] ?? id) : v).join(', ');
  const parts: string[] = [];
  for (const field of FILTERABLE_FIELDS) {
    const v = filter[field];
    if (v?.length) parts.push(`${field} in [${name(field, v)}]`);
  }
  for (const field of FILTERABLE_FIELDS) {
    const v = filter.exclude?.[field];
    if (v?.length) parts.push(`${field} not in [${name(field, v)}]`);
  }
  return parts.length ? parts.join(' AND ') : 'no filter (all tickets)';
}
