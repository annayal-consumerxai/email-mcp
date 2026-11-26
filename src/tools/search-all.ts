import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AccountManager } from '../account-manager.js';
import type { SearchQuery, Email } from '../models/types.js';
import { cleanLinksDeep } from '../agni/links.js';

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * email_search_all: one search across every configured account (or a chosen
 * subset), run in parallel. Results are merged newest first and each one keeps
 * its accountId and accountEmail, so a follow-up email_get or
 * email_draft_create knows which mailbox to use. An account that fails is
 * reported in `errors` and does not sink the others.
 */
export function registerSearchAllTool(server: McpServer, accountManager: AccountManager): void {
  server.tool(
    'email_search_all',
    'Search every configured email account at once (or the ones listed in accountIds). Same filters as email_search. Results are merged newest first; each result carries accountId and accountEmail. Accounts that fail are listed under errors. Returns compact results by default; set returnBody=true for full bodies.',
    {
      accountIds: z.array(z.string()).optional().describe('Limit the search to these account IDs (default: all accounts)'),
      folder: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      since: z.string().optional(),
      before: z.string().optional(),
      unreadOnly: z.boolean().optional(),
      starredOnly: z.boolean().optional(),
      hasAttachment: z.boolean().optional(),
      limit: z.number().optional().describe(`Total results to return across all accounts (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
      returnBody: z.boolean().optional().describe('Include full email bodies (default: false)'),
    },
    async (args) => {
      try {
        const limit = Math.min(Math.max(1, Math.floor(args.limit ?? DEFAULT_LIMIT)), MAX_LIMIT);
        const all = await accountManager.listAccounts();
        const wanted = args.accountIds?.length ? new Set(args.accountIds) : null;
        const accounts = wanted ? all.filter((a) => wanted.has(a.id)) : all;
        const unknown = wanted ? [...wanted].filter((id) => !all.some((a) => a.id === id)) : [];

        const query: SearchQuery = { limit, returnBody: args.returnBody ?? false };
        for (const key of ['folder', 'from', 'to', 'subject', 'body', 'since', 'before', 'unreadOnly', 'starredOnly', 'hasAttachment'] as const) {
          if (args[key] !== undefined) (query as Record<string, unknown>)[key] = args[key];
        }

        const settled = await Promise.allSettled(
          accounts.map(async (acct) => {
            const provider = await accountManager.getProvider(acct.id);
            const emails = await provider.search(query);
            return emails.map((e) => ({ ...e, accountId: acct.id, accountEmail: acct.email }));
          }),
        );

        const results: Array<Email & { accountEmail: string }> = [];
        const errors: Array<{ accountId: string; error: string }> = unknown.map((id) => ({ accountId: id, error: 'No such account' }));
        settled.forEach((s, i) => {
          if (s.status === 'fulfilled') results.push(...s.value);
          else errors.push({ accountId: accounts[i].id, error: s.reason?.message ?? String(s.reason) });
        });

        const time = (d: string) => {
          const t = Date.parse(d);
          return Number.isNaN(t) ? 0 : t;
        };
        results.sort((a, b) => time(b.date) - time(a.date));

        let page = results.slice(0, limit);
        if (!args.returnBody) page = page.map((e) => ({ ...e, body: { text: undefined, html: undefined } }));

        return jsonResult({
          searchedAccounts: accounts.map((a) => a.id),
          total: results.length,
          returned: page.length,
          results: cleanLinksDeep(page),
          errors,
        });
      } catch (error: any) {
        return jsonResult({ error: error.message });
      }
    },
  );
}
