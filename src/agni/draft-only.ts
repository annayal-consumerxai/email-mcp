import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Drafts-only mode (EMAIL_MCP_DRAFT_ONLY=1).
 *
 * An assistant that reads mail can be talked into acting on it by the mail
 * itself. In drafts-only mode nothing leaves the mailbox and nothing is
 * destroyed: every tool that sends, forwards, deletes, or sets up a standing
 * rule is never registered, so the assistant cannot see or call it. Replies
 * and new mail go through email_draft_create (with inReplyToEmailId for a
 * reply) and a person presses Send in their mail client.
 *
 * Reversible changes (mark read, label, move, report spam) stay available.
 */
export const DRAFT_ONLY_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  'email_send',
  'email_reply',
  'email_forward',
  'email_delete',
  'email_batch_delete',
  'email_transfer',
  'email_create_forward_rule',
  'email_delete_forward_rule',
  'email_create_block_rule',
  'email_delete_block_rule',
  'email_add_account',
  'email_remove_account',
]);

export function isDraftOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.EMAIL_MCP_DRAFT_ONLY ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Returns a view of the server whose tool() silently skips blocked tools.
 * Every other property and method is passed through to the real server.
 */
export function withDraftOnlyGuard(server: McpServer, enabled: boolean): McpServer {
  if (!enabled) return server;
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === 'tool') {
        return (name: string, ...rest: unknown[]) => {
          if (DRAFT_ONLY_BLOCKED_TOOLS.has(name)) return undefined;
          return (target.tool as (...a: unknown[]) => unknown).call(target, name, ...rest);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
