import type { Email } from '../models/types.js';

/**
 * Link cleaning (on by default, EMAIL_MCP_CLEAN_LINKS=0 turns it off).
 *
 * Mail often carries links wrapped in a redirector: Google's
 * https://www.google.com/url?q=<real>, Outlook Safe Links
 * (*.safelinks.protection.outlook.com/?url=<real>). Read through an assistant,
 * those wrappers hide the real destination and get copied into replies and
 * drafts. This unwraps them to the real URL in the text and HTML bodies and
 * the snippet. Only the known wrapper shapes are touched.
 */

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

function unwrapOne(raw: string): string {
  // HTML bodies encode & as &amp; inside href attributes.
  const decoded = raw.replace(/&amp;/g, '&');
  let u: URL;
  try {
    u = new URL(decoded);
  } catch {
    return raw;
  }
  const host = u.hostname.toLowerCase();
  let target: string | null = null;
  if (/^(www\.)?google\.[a-z.]+$/.test(host) && u.pathname === '/url') {
    target = u.searchParams.get('q') ?? u.searchParams.get('url');
  } else if (host.endsWith('.safelinks.protection.outlook.com')) {
    target = u.searchParams.get('url');
  }
  if (!target || !/^https?:\/\//i.test(target)) return raw;
  // A wrapper inside a wrapper happens when mail is forwarded twice.
  return unwrapOne(target);
}

export function unwrapLinks(input: string): string;
export function unwrapLinks(input: string | undefined): string | undefined;
export function unwrapLinks(input: string | undefined): string | undefined {
  if (!input) return input;
  return input.replace(URL_RE, (m) => unwrapOne(m));
}

export function cleanLinksEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.EMAIL_MCP_CLEAN_LINKS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

export function cleanEmailLinks<T extends Partial<Email>>(email: T): T {
  if (!cleanLinksEnabled() || !email || typeof email !== 'object') return email;
  const out: T = { ...email };
  if (email.body) {
    out.body = { ...email.body, text: unwrapLinks(email.body.text), html: unwrapLinks(email.body.html) };
  }
  if (email.snippet !== undefined) out.snippet = unwrapLinks(email.snippet);
  return out;
}

/** Cleans an email, an array of emails, or a thread-like object holding `messages`/`emails`. */
export function cleanLinksDeep<T>(value: T): T {
  if (!cleanLinksEnabled()) return value;
  if (Array.isArray(value)) return value.map((v) => cleanLinksDeep(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('body' in obj || 'snippet' in obj) return cleanEmailLinks(obj as Partial<Email>) as T;
    const out: Record<string, unknown> = { ...obj };
    for (const key of ['messages', 'emails']) {
      if (Array.isArray(obj[key])) out[key] = (obj[key] as unknown[]).map((v) => cleanLinksDeep(v));
    }
    return out as T;
  }
  return value;
}
