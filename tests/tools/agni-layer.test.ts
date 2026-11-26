import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServer } from '../../src/server.js';
import { registerSearchAllTool } from '../../src/tools/search-all.js';
import { unwrapLinks, cleanLinksDeep } from '../../src/agni/links.js';
import { DRAFT_ONLY_BLOCKED_TOOLS } from '../../src/agni/draft-only.js';
import type { AccountManager } from '../../src/account-manager.js';

function tools(server: McpServer): Record<string, { handler: Function }> {
  return (server as any)._registeredTools;
}

const fakeMgr = () =>
  ({ listAccounts: vi.fn().mockResolvedValue([]), getProvider: vi.fn() }) as unknown as AccountManager;

afterEach(() => {
  delete process.env.EMAIL_MCP_DRAFT_ONLY;
  delete process.env.EMAIL_MCP_CLEAN_LINKS;
});

describe('drafts-only mode', () => {
  it('registers send/delete tools when off', async () => {
    const { server } = await createServer(fakeMgr());
    const names = Object.keys(tools(server));
    expect(names).toContain('email_send');
    expect(names).toContain('email_search_all');
  });

  it('drops every blocked tool when on, keeps drafts and reading', async () => {
    process.env.EMAIL_MCP_DRAFT_ONLY = '1';
    const { server } = await createServer(fakeMgr());
    const names = Object.keys(tools(server));
    for (const blocked of DRAFT_ONLY_BLOCKED_TOOLS) expect(names).not.toContain(blocked);
    for (const kept of ['email_search', 'email_search_all', 'email_get', 'email_get_thread', 'email_draft_create', 'email_draft_update', 'email_mark', 'email_label']) {
      expect(names).toContain(kept);
    }
  });
});

describe('link cleaning', () => {
  it('unwraps Google redirect links, including HTML-encoded ones', () => {
    const real = 'https://agniverse.co/pricing?a=1&b=2';
    const g = `https://www.google.com/url?q=${encodeURIComponent(real)}&sa=D&source=editors`;
    expect(unwrapLinks(`see ${g} now`)).toBe(`see ${real} now`);
    expect(unwrapLinks(`<a href="${g.replace(/&/g, '&amp;')}">x</a>`)).toBe(`<a href="${real}">x</a>`);
  });

  it('unwraps Outlook Safe Links and nested wrappers', () => {
    const real = 'https://example.com/doc';
    const safe = `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(real)}&data=abc`;
    const nested = `https://www.google.com/url?q=${encodeURIComponent(safe)}`;
    expect(unwrapLinks(safe)).toBe(real);
    expect(unwrapLinks(nested)).toBe(real);
  });

  it('leaves ordinary links and non-http targets alone', () => {
    const plain = 'https://www.google.com/search?q=hello';
    expect(unwrapLinks(plain)).toBe(plain);
    const js = `https://www.google.com/url?q=${encodeURIComponent('javascript:alert(1)')}`;
    expect(unwrapLinks(js)).toBe(js);
  });

  it('cleans threads and can be turned off', () => {
    const g = `https://www.google.com/url?q=${encodeURIComponent('https://a.com')}`;
    const thread = { id: 't', messages: [{ body: { text: g }, snippet: g }] };
    expect(cleanLinksDeep(thread).messages[0].body.text).toBe('https://a.com');
    process.env.EMAIL_MCP_CLEAN_LINKS = '0';
    expect(cleanLinksDeep(thread).messages[0].body.text).toBe(g);
  });
});

describe('email_search_all', () => {
  it('merges accounts newest first, tags each result, reports failures', async () => {
    const mk = (id: string, date: string) => ({ id, date, subject: id, body: { text: 'x' }, attachments: [], flags: {} });
    const providers: Record<string, any> = {
      a: { search: vi.fn().mockResolvedValue([mk('a1', '2026-11-01T10:00:00Z'), mk('a2', '2026-11-20T10:00:00Z')]) },
      b: { search: vi.fn().mockResolvedValue([mk('b1', '2026-11-10T10:00:00Z')]) },
      c: { search: vi.fn().mockRejectedValue(new Error('token expired')) },
    };
    const mgr = {
      listAccounts: vi.fn().mockResolvedValue([
        { id: 'a', email: 'a@x.co' },
        { id: 'b', email: 'b@x.co' },
        { id: 'c', email: 'c@x.co' },
      ]),
      getProvider: vi.fn(async (id: string) => providers[id]),
    } as unknown as AccountManager;
    const server = new McpServer({ name: 't', version: '0' });
    registerSearchAllTool(server, mgr);
    const res = await tools(server).email_search_all.handler({ subject: 'invoice', limit: 2 }, {});
    const out = JSON.parse(res.content[0].text);
    expect(out.results.map((r: any) => r.id)).toEqual(['a2', 'b1']);
    expect(out.results[0].accountEmail).toBe('a@x.co');
    expect(out.results[0].body.text).toBeUndefined();
    expect(out.total).toBe(3);
    expect(out.errors).toEqual([{ accountId: 'c', error: 'token expired' }]);
    expect(providers.a.search).toHaveBeenCalledWith(expect.objectContaining({ subject: 'invoice', limit: 2 }));
  });
});

describe('draft open link', () => {
  it('builds a Gmail link for the right account and skips other providers', async () => {
    const { draftLink, gmailDraftUrl } = await import('../../src/agni/draft-link.js');
    expect(gmailDraftUrl('media@agniverse.co', '18c2f')).toBe('https://mail.google.com/mail/u/media%40agniverse.co/#drafts?compose=18c2f');
    const mgr = {
      listAccounts: vi.fn().mockResolvedValue([
        { id: 'g', provider: 'gmail', email: 'media@agniverse.co' },
        { id: 'o', provider: 'outlook', email: 'x@outlook.com' },
      ]),
    } as unknown as AccountManager;
    expect((await draftLink(mgr, 'g', '18c2f')).openUrl).toContain('/u/media%40agniverse.co/');
    expect(await draftLink(mgr, 'o', 'abc')).toEqual({});
    expect(await draftLink(mgr, 'g', undefined)).toEqual({});
  });
});

describe('from alias guard', () => {
  it('refuses `from` on a non-Gmail account before anything is created', async () => {
    const { registerSendingTools } = await import('../../src/tools/sending.js');
    const provider = { providerType: 'outlook', createDraft: vi.fn() };
    const mgr = { getProvider: vi.fn().mockResolvedValue(provider), listAccounts: vi.fn().mockResolvedValue([]) } as unknown as AccountManager;
    const server = new McpServer({ name: 't', version: '0' });
    registerSendingTools(server, mgr);
    const res = await tools(server).email_draft_create.handler(
      { accountId: 'o', to: [{ email: 'a@b.co' }], subject: 's', body: { text: 'x' }, from: 'alias@x.co' },
      {},
    );
    expect(JSON.parse(res.content[0].text).error).toMatch(/only supported on Gmail/);
    expect(provider.createDraft).not.toHaveBeenCalled();
  });
});
