import type { AccountManager } from '../account-manager.js';

/**
 * A browser link that opens a saved draft, so a person can check it and press
 * Send (the other half of drafts-only mode). Gmail only for now: Gmail opens
 * a draft from its message id, and /u/<address>/ picks the right signed-in
 * account. Other providers get no link.
 */
export function gmailDraftUrl(accountEmail: string, messageId: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#drafts?compose=${encodeURIComponent(messageId)}`;
}

export async function draftLink(
  accountManager: AccountManager,
  accountId: string,
  messageId: string | undefined,
): Promise<{ openUrl?: string }> {
  if (!messageId) return {};
  try {
    const accounts = await accountManager.listAccounts();
    const acct = accounts.find((a) => a.id === accountId);
    if (!acct || acct.provider !== 'gmail' || !acct.email) return {};
    return { openUrl: gmailDraftUrl(acct.email, messageId) };
  } catch {
    return {};
  }
}
