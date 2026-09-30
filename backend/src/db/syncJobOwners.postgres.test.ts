/**
 * Real-Postgres proof of the sync-scope ownership backfill (dataMigrations
 * assignSyncJobOwners): a ticket is assigned to a job only where that job is
 * the sole one on its account, and running it again changes nothing.
 */
import { prisma } from './prisma';
import { assignSyncJobOwners } from './dataMigrations';

const describePostgres =
  process.env.ANCHORDESK_POSTGRES_INTEGRATION === '1' ? describe : describe.skip;

describePostgres('sync job ownership backfill', () => {
  const tag = `owners-${Date.now()}`;
  let companyId: number;
  let connectionId: number;
  const jobIds: number[] = [];
  const ticketIds: number[] = [];

  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: `Backfill ${tag}` } })).id;
    connectionId = (await prisma.connection.create({ data: { name: `jira ${tag}`, type: 'jira', config: {} } })).id;
    const job = (name: string, type: 'jira' | 'connectwise', conn: number | null) =>
      prisma.syncProvider.create({ data: { name: `${name} ${tag}`, type, config: {}, connectionId: conn } });
    const soleJira = await job('sole jira', 'jira', connectionId);
    const cwA = await job('cw board A', 'connectwise', null);
    const cwB = await job('cw board B', 'connectwise', null);
    jobIds.push(soleJira.id, cwA.id, cwB.id);

    const ticket = (externalId: string | null, provider: string | null, conn: number | null) =>
      prisma.ticket.create({
        data: { title: `${tag} ${externalId ?? 'local'}`, status: 'New', companyId, externalId, externalProvider: provider, syncConnectionId: conn },
      });
    ticketIds.push(
      (await ticket(`HELP-${tag}`, 'jira', connectionId)).id,
      (await ticket(`${Date.now()}`, 'connectwise', null)).id,
      (await ticket(null, null, null)).id,
    );
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.syncProvider.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.connection.deleteMany({ where: { id: connectionId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it('assigns only provable owners, idempotently', async () => {
    // Other rows in a shared test database may also be assigned; ours are checked by id.
    await assignSyncJobOwners();
    const rows = await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, orderBy: { id: 'asc' } });
    const [jiraTicket, cwTicket, localTicket] = rows;

    expect(jiraTicket.syncJobId).toBe(jobIds[0]);
    // Two ConnectWise jobs share the legacy account: the owner can't be proven.
    expect(cwTicket.syncJobId).toBeNull();
    expect(localTicket.syncJobId).toBeNull();

    await assignSyncJobOwners();
    const again = await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, orderBy: { id: 'asc' } });
    expect(again.map((t) => t.syncJobId)).toEqual(rows.map((t) => t.syncJobId));
  });
});
