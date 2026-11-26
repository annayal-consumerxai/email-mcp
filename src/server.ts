import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AccountManager } from './account-manager.js';
import { registerAccountTools } from './tools/accounts.js';
import { registerReadingTools } from './tools/reading.js';
import { registerSendingTools } from './tools/sending.js';
import { registerOrganizingTools } from './tools/organizing.js';
import { registerModerationTools } from './tools/moderation.js';
import { registerForwardingTools } from './tools/forwarding.js';
import { registerSearchAllTool } from './tools/search-all.js';
import { isDraftOnly, withDraftOnlyGuard } from './agni/draft-only.js';

/**
 * The version reported to MCP clients in the initialize handshake. Kept equal
 * to package.json's version by tests/integration/smoke.test.ts; bump both
 * together. (A runtime read of package.json is not used because esbuild
 * bundles entry points at different depths under dist/.)
 */
export const SERVER_VERSION = '1.11.0';

export interface ServerResult {
  server: McpServer;
  accountManager: AccountManager;
}

export async function createServer(accountManager?: AccountManager): Promise<ServerResult> {
  const mgr = accountManager ?? new AccountManager();

  const server = new McpServer({
    name: 'email-mcp',
    version: SERVER_VERSION,
  });

  // Register all tool groups. In drafts-only mode the guarded view skips every
  // tool that sends, deletes, or sets up a standing rule (src/agni/draft-only.ts).
  const s = withDraftOnlyGuard(server, isDraftOnly());
  registerAccountTools(s, mgr);
  registerReadingTools(s, mgr);
  registerSearchAllTool(s, mgr);
  registerSendingTools(s, mgr);
  registerOrganizingTools(s, mgr);
  registerModerationTools(s, mgr);
  registerForwardingTools(s, mgr);

  return { server, accountManager: mgr };
}

export async function startServer(): Promise<void> {
  const { server } = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
