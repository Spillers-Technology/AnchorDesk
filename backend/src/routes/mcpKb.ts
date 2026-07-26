/**
 * Knowledge-base MCP parity. Kept out of the already-large transport module so
 * the REST/MCP workflow remains reviewable as one bounded feature.
 */
import type { UserRole } from '@prisma/client';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as kb from '../repositories/kbArticleRepository';

function textResult(text: string, isError = false) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function jsonResult(value: unknown) {
  return textResult(JSON.stringify(value, null, 2));
}

function requireAuthor(role: UserRole) {
  return role === 'admin' || role === 'technician'
    ? null
    : textResult('Requires role: admin or technician', true);
}

function validationResult(error: unknown) {
  return error instanceof kb.KbArticleValidationError
    ? textResult(error.message, true)
    : null;
}

const visibility = z.enum(['internal', 'portal']);

export function registerKbTools(
  server: McpServer,
  actor: string,
  role: UserRole,
): void {
  server.tool(
    'search_kb_articles',
    'Search published knowledge-base articles with AnchorDesk ranked full-text + typo-tolerant search. Internal articles remain staff-only; use this before inventing an answer for a ticket.',
    {
      q: z.string().trim().min(1).max(500).describe('Words or question to search for'),
      visibility: visibility.optional().describe('Optionally narrow to internal or portal-published answers'),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    {
      title: 'Search knowledge base',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ q, visibility: requestedVisibility, limit }) =>
      jsonResult(await kb.searchPublishedStaff(q, {
        visibility: requestedVisibility,
        limit,
      })),
  );

  server.tool(
    'read_kb_article',
    'Read a knowledge-base article by its stable slug. Normal reads return published staff-visible content; technicians/admins may explicitly include a draft for editing.',
    {
      slug: z.string().trim().min(1).max(200),
      includeUnpublished: z.boolean().optional().default(false),
    },
    {
      title: 'Read knowledge-base article',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ slug, includeUnpublished }) => {
      if (includeUnpublished) {
        const denied = requireAuthor(role);
        if (denied) return denied;
      }
      const article = includeUnpublished
        ? await kb.getForAuthorBySlug(slug)
        : await kb.getPublishedForStaffBySlug(slug);
      return article
        ? jsonResult(article)
        : textResult(`Knowledge-base article "${slug}" not found`, true);
    },
  );

  server.tool(
    'list_kb_articles',
    'List knowledge-base articles for browsing or administration. Draft inclusion is restricted to technicians and admins.',
    {
      visibility: visibility.optional(),
      includeUnpublished: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(500).optional().default(100),
    },
    {
      title: 'List knowledge-base articles',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ visibility: requestedVisibility, includeUnpublished, limit }) => {
      if (includeUnpublished) {
        const denied = requireAuthor(role);
        if (denied) return denied;
      }
      return jsonResult(
        includeUnpublished
          ? await kb.listForAuthors({ visibility: requestedVisibility, limit })
          : await kb.listPublishedForStaff({ visibility: requestedVisibility, limit }),
      );
    },
  );

  server.tool(
    'create_kb_article',
    'Create a knowledge-base article. The server sanitizes HTML, assigns a collision-safe stable slug, and records the mutation in the audit log. Technician or administrator only.',
    {
      title: z.string().trim().min(1).max(255),
      bodyHtml: z.string().trim().min(1).max(1_000_000),
      category: z.string().trim().min(1).max(100),
      visibility: visibility.optional().default('internal'),
      published: z.boolean().optional().default(false),
    },
    {
      title: 'Create knowledge-base article',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (input) => {
      const denied = requireAuthor(role);
      if (denied) return denied;
      try {
        return jsonResult(await kb.create(input, actor));
      } catch (error) {
        const validation = validationResult(error);
        if (validation) return validation;
        throw error;
      }
    },
  );

  server.tool(
    'update_kb_article',
    'Update article content or publication metadata without changing its stable slug. Technician or administrator only.',
    {
      articleId: z.number().int().positive(),
      title: z.string().trim().min(1).max(255).optional(),
      bodyHtml: z.string().trim().min(1).max(1_000_000).optional(),
      category: z.string().trim().min(1).max(100).optional(),
      visibility: visibility.optional(),
      published: z.boolean().optional(),
    },
    {
      title: 'Update knowledge-base article',
      readOnlyHint: false,
      destructiveHint: false,
      // A retry records a fresh audit event and advances updatedAt.
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ articleId, ...input }) => {
      const denied = requireAuthor(role);
      if (denied) return denied;
      if (Object.values(input).every((value) => value === undefined)) {
        return textResult('Provide at least one article field to update', true);
      }
      try {
        const article = await kb.update(articleId, input, actor);
        return article
          ? jsonResult(article)
          : textResult(`Knowledge-base article ${articleId} not found`, true);
      } catch (error) {
        const validation = validationResult(error);
        if (validation) return validation;
        throw error;
      }
    },
  );

  server.tool(
    'delete_kb_article',
    'Remove an article from every browse/search surface while reserving its slug so the old URL can never point to different content. Technician or administrator only.',
    {
      articleId: z.number().int().positive(),
    },
    {
      title: 'Delete knowledge-base article',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async ({ articleId }) => {
      const denied = requireAuthor(role);
      if (denied) return denied;
      return (await kb.remove(articleId, actor))
        ? jsonResult({ ok: true, articleId })
        : textResult(`Knowledge-base article ${articleId} not found`, true);
    },
  );
}
