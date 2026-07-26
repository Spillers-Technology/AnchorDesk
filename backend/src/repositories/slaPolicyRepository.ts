import { prisma } from '../db/prisma';
import * as audit from './auditRepository';

export interface SlaPolicyInput {
  name: string;
  priority?: string | null;
  companyId?: number | null;
  responseMinutes: number;
  resolutionMinutes: number;
  enabled?: boolean;
}

export function list() {
  return prisma.slaPolicy.findMany({ orderBy: [{ companyId: 'asc' }, { priority: 'asc' }] });
}

export function getById(id: number) {
  return prisma.slaPolicy.findUnique({ where: { id } });
}

export function create(input: SlaPolicyInput, actorSub: string) {
  return prisma.$transaction(async (tx) => {
    const policy = await tx.slaPolicy.create({
      data: {
        name: input.name,
        priority: input.priority ?? null,
        companyId: input.companyId ?? null,
        responseMinutes: input.responseMinutes,
        resolutionMinutes: input.resolutionMinutes,
        enabled: input.enabled ?? true,
      },
    });
    await audit.record({
      entityType: 'sla_policy',
      entityId: policy.id,
      action: 'create',
      changedBy: actorSub,
      newValue: policy as unknown as Record<string, unknown>,
    }, tx);
    return policy;
  });
}

export function update(id: number, input: Partial<SlaPolicyInput>, actorSub: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.slaPolicy.findUniqueOrThrow({ where: { id } });
    const policy = await tx.slaPolicy.update({ where: { id }, data: input });
    await audit.record({
      entityType: 'sla_policy',
      entityId: id,
      action: 'update',
      changedBy: actorSub,
      oldValue: before as unknown as Record<string, unknown>,
      newValue: policy as unknown as Record<string, unknown>,
    }, tx);
    return policy;
  });
}

export function remove(id: number, actorSub: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.slaPolicy.findUniqueOrThrow({ where: { id } });
    const policy = await tx.slaPolicy.delete({ where: { id } });
    await audit.record({
      entityType: 'sla_policy',
      entityId: id,
      action: 'delete',
      changedBy: actorSub,
      oldValue: before as unknown as Record<string, unknown>,
    }, tx);
    return policy;
  });
}
