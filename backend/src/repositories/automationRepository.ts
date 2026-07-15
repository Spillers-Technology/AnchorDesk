import { AutomationTrigger, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import * as audit from './auditRepository';
import type { RuleCondition, RuleAction } from '../services/automation/evaluate';

export interface AutomationRuleInput {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export function list() {
  return prisma.automationRule.findMany({ orderBy: [{ trigger: 'asc' }, { name: 'asc' }] });
}

export function listEnabledFor(trigger: AutomationTrigger) {
  return prisma.automationRule.findMany({ where: { trigger, enabled: true }, orderBy: { id: 'asc' } });
}

export async function create(input: AutomationRuleInput, actorSub: string) {
  const rule = await prisma.automationRule.create({
    data: {
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      trigger: input.trigger,
      conditions: input.conditions as unknown as Prisma.InputJsonValue,
      actions: input.actions as unknown as Prisma.InputJsonValue,
    },
  });
  await audit.record({
    entityType: 'automation_rule',
    entityId: rule.id,
    action: 'create',
    changedBy: actorSub,
    newValue: { name: rule.name, trigger: rule.trigger },
  });
  return rule;
}

export async function update(id: number, input: Partial<AutomationRuleInput>, actorSub: string) {
  const before = await prisma.automationRule.findUnique({ where: { id } });
  const rule = await prisma.automationRule.update({
    where: { id },
    data: {
      name: input.name?.trim(),
      enabled: input.enabled,
      trigger: input.trigger,
      conditions: input.conditions !== undefined ? (input.conditions as unknown as Prisma.InputJsonValue) : undefined,
      actions: input.actions !== undefined ? (input.actions as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
  await audit.record({
    entityType: 'automation_rule',
    entityId: id,
    action: 'update',
    changedBy: actorSub,
    oldValue: before ? { name: before.name, enabled: before.enabled, trigger: before.trigger } : null,
    newValue: { name: rule.name, enabled: rule.enabled, trigger: rule.trigger },
  });
  return rule;
}

export async function remove(id: number, actorSub: string) {
  const before = await prisma.automationRule.findUnique({ where: { id } });
  await prisma.automationRule.delete({ where: { id } });
  await audit.record({
    entityType: 'automation_rule',
    entityId: id,
    action: 'delete',
    changedBy: actorSub,
    oldValue: before ? { name: before.name } : null,
  });
}

/** Bump run bookkeeping after a rule fires (no audit — it's telemetry). */
export function markRan(id: number) {
  return prisma.automationRule.update({
    where: { id },
    data: { runCount: { increment: 1 }, lastRunAt: new Date() },
  });
}
