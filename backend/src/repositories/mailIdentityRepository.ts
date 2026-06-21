import { prisma } from '../db/prisma';

export interface MailIdentityInput {
  address: string;
  displayName?: string | null;
  shared?: boolean;
  userId?: number | null;
  enabled?: boolean;
}

export function list() {
  return prisma.mailIdentity.findMany({ orderBy: [{ shared: 'desc' }, { address: 'asc' }] });
}

/** Identities a given user may send as: shared boxes + their own aliases. */
export function listForUser(userId: number) {
  return prisma.mailIdentity.findMany({
    where: { enabled: true, OR: [{ shared: true }, { userId }] },
    orderBy: [{ shared: 'desc' }, { address: 'asc' }],
  });
}

export function getById(id: number) {
  return prisma.mailIdentity.findUnique({ where: { id } });
}

export function create(input: MailIdentityInput) {
  return prisma.mailIdentity.create({
    data: {
      address: input.address.trim().toLowerCase(),
      displayName: input.displayName ?? null,
      shared: input.shared ?? true,
      userId: input.userId ?? null,
      enabled: input.enabled ?? true,
    },
  });
}

export function update(id: number, input: Partial<MailIdentityInput>) {
  return prisma.mailIdentity.update({ where: { id }, data: input });
}

export function remove(id: number) {
  return prisma.mailIdentity.delete({ where: { id } });
}
