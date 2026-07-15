import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface TeamInput {
  name: string;
  description?: string | null;
}

const memberInclude = {
  members: {
    include: { user: { select: { id: true, username: true, displayName: true, role: true } } },
  },
  _count: { select: { tickets: true } },
} as const;

export function list() {
  return prisma.team.findMany({ orderBy: { name: 'asc' }, include: memberInclude });
}

export function getById(id: number) {
  return prisma.team.findUnique({ where: { id }, include: memberInclude });
}

export async function create(input: TeamInput, actorSub: string) {
  const team = await prisma.team.create({
    data: { name: input.name.trim(), description: input.description?.trim() || null },
    include: memberInclude,
  });
  await audit.record({
    entityType: 'team',
    entityId: team.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { name: team.name, description: team.description },
  });
  return team;
}

export async function update(id: number, input: Partial<TeamInput>, actorSub: string) {
  const before = await prisma.team.findUnique({ where: { id } });
  const team = await prisma.team.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      description: input.description === undefined ? undefined : input.description?.trim() || null,
    },
    include: memberInclude,
  });
  await audit.record({
    entityType: 'team',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before ? { name: before.name, description: before.description } : null,
    newValue: { name: team.name, description: team.description },
  });
  return team;
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.team.findUnique({ where: { id } });
  await prisma.team.delete({ where: { id } });
  await audit.record({
    entityType: 'team',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before ? { name: before.name } : null,
  });
}

/** Idempotently add a user to a team. */
export async function addMember(teamId: number, userId: number, actorSub: string) {
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId } },
    create: { teamId, userId },
    update: {},
  });
  await audit.record({
    entityType: 'team',
    entityId: teamId,
    action: 'update',
    changedBy: actorSub,
    newValue: { memberAdded: userId },
  });
  return getById(teamId);
}

export async function removeMember(teamId: number, userId: number, actorSub: string) {
  await prisma.teamMember.deleteMany({ where: { teamId, userId } });
  await audit.record({
    entityType: 'team',
    entityId: teamId,
    action: 'update',
    changedBy: actorSub,
    newValue: { memberRemoved: userId },
  });
  return getById(teamId);
}

/** Ids of a team's members (for automation notify actions). */
export async function memberUserIds(teamId: number): Promise<number[]> {
  const rows = await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
