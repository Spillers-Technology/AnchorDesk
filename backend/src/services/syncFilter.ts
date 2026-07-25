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
 *     and the response stays small. `JiraProvider` folds these into JQL.
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
 */

/** Ticket fields that can be filtered on. Provider-neutral by design. */
export const FILTERABLE_FIELDS = ['assignee', 'status', 'priority', 'companyName'] as const;
export type FilterableField = (typeof FILTERABLE_FIELDS)[number];

export type SyncFilter = Partial<Record<FilterableField, string[]>> & {
  exclude?: Partial<Record<FilterableField, string[]>>;
};

/** The subset of an external ticket a filter can see. */
export type FilterableTicket = Partial<Record<FilterableField, string | undefined>>;

const norm = (v: string | undefined): string => (v ?? '').trim().toLowerCase();

function listMatches(values: string[] | undefined, actual: string | undefined): boolean {
  if (!values || values.length === 0) return true;
  const a = norm(actual);
  return values.some((v) => norm(v) === a);
}

/** True when the ticket satisfies the filter. An empty filter matches everything. */
export function matches(ticket: FilterableTicket, filter?: SyncFilter | null): boolean {
  if (!filter) return true;

  for (const field of FILTERABLE_FIELDS) {
    if (!listMatches(filter[field], ticket[field])) return false;
  }

  const excl = filter.exclude;
  if (excl) {
    for (const field of FILTERABLE_FIELDS) {
      const values = excl[field];
      if (!values || values.length === 0) continue;
      const a = norm(ticket[field]);
      if (values.some((v) => norm(v) === a)) return false;
    }
  }

  return true;
}

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
    if (key === 'exclude') continue;
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

  return Object.keys(out).length ? out : null;
}

/** Human-readable one-liner for logs and the Sync view. */
export function describeSyncFilter(filter?: SyncFilter | null): string {
  if (!filter) return 'no filter (all tickets)';
  const parts: string[] = [];
  for (const field of FILTERABLE_FIELDS) {
    const v = filter[field];
    if (v?.length) parts.push(`${field} in [${v.join(', ')}]`);
  }
  for (const field of FILTERABLE_FIELDS) {
    const v = filter.exclude?.[field];
    if (v?.length) parts.push(`${field} not in [${v.join(', ')}]`);
  }
  return parts.length ? parts.join(' AND ') : 'no filter (all tickets)';
}
