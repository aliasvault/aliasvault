import type { BridgeContext } from '../types/context.js';
import type { IncomingEmail, EmailPayload } from '../types/email.js';
import { emailsReceived, encryptionErrors } from '../metrics.js';

/**
 * Extract alias local part from "to" address.
 * Handles formats: "alias@domain" or "Alias Name <alias@domain>"
 */
export function extractLocalPart(to: string): string | null {
  const match = to.match(/<?([^@<\s]+)@/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Shared email processing pipeline used by both /receive-email and /mox-webhook routes.
 * Performs: alias lookup → encrypt → IPFS upload → manifest update → notification queue.
 */
export async function processIncomingEmail(
  ctx: BridgeContext,
  email: IncomingEmail,
): Promise<{ cid: string }> {
  emailsReceived.inc();

  // Extract alias
  const localPart = extractLocalPart(email.to);
  if (!localPart) {
    throw new PipelineError(400, 'Invalid "to" address format');
  }

  // Look up alias -> VaultRegistry address
  const contractAddress = await ctx.aliasLookup.lookupAlias(localPart);
  if (!contractAddress) {
    throw new PipelineError(404, 'Alias not registered');
  }

  // Get recipient's email public key
  const emailPublicKey = await ctx.emailKeyLookup.getEmailPublicKey(contractAddress);
  if (!emailPublicKey) {
    throw new PipelineError(404, 'Recipient has no email public key configured');
  }

  // Build email payload
  const payload: EmailPayload = {
    from: email.from,
    to: email.to,
    subject: email.subject,
    body: email.body,
    attachments: email.attachments,
    receivedAt: Math.floor(Date.now() / 1000),
  };

  // Encrypt
  let encrypted: Uint8Array;
  try {
    encrypted = ctx.emailEncryptor.encrypt(JSON.stringify(payload), emailPublicKey);
  } catch (err) {
    encryptionErrors.inc();
    console.error('[email-pipeline] Encryption error:', err);
    throw new PipelineError(500, 'Encryption failed');
  }

  // Upload encrypted email to IPFS
  const emailCid = await ctx.ipfs.upload(encrypted);

  // Read current manifest CID from VaultRegistry public ledger via indexer
  const existingManifestCid = await ctx.readInboxManifestCid(contractAddress);

  // Update manifest: fetch existing (or create new), append entry, re-upload
  const manifestCid = await ctx.manifestManager.appendAndUpload(existingManifestCid, emailCid);

  // Queue notification
  ctx.notificationQueue.enqueue(contractAddress, manifestCid);

  return { cid: emailCid };
}

export class PipelineError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}
