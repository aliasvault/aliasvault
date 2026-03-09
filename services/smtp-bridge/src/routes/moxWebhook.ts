import { Router } from 'express';
import type { BridgeContext } from '../types/context.js';
import type { IncomingEmail } from '../types/email.js';
import type { MoxWebhookPayload, MoxStructurePart } from '../types/moxWebhook.js';
import { webhookAuth } from '../middleware/auth.js';
import { processIncomingEmail, PipelineError } from '../services/emailPipeline.js';

function isAttachmentPart(part: MoxStructurePart): boolean {
  return (
    part.ContentDisposition === 'attachment' ||
    (!part.ContentType.startsWith('text/') && !part.ContentType.startsWith('multipart/'))
  );
}

function hasAttachmentParts(structure: MoxStructurePart): boolean {
  if (isAttachmentPart(structure)) return true;
  return structure.Parts?.some(hasAttachmentParts) ?? false;
}

export function transformMoxPayload(mox: MoxWebhookPayload): IncomingEmail {
  if (mox.Structure && hasAttachmentParts(mox.Structure)) {
    console.warn(`[mox-webhook] Email ${mox.Meta.MsgID} has attachments — skipping (MVP)`);
  }
  return {
    from: mox.From?.[0]?.Address ?? mox.Meta.MailFrom,
    to: mox.To?.[0]?.Address ?? mox.Meta.RcptTo,
    subject: mox.Subject ?? '',
    body: mox.Text || mox.HTML || '',
  };
}

export function createMoxWebhookRouter(ctx: BridgeContext): Router {
  const router = Router();

  router.post('/mox-webhook', webhookAuth(ctx), async (req, res) => {
    try {
      const moxPayload = req.body as MoxWebhookPayload;

      // Validate required Mox fields
      if (moxPayload.Meta?.MsgID == null || (!moxPayload.To?.length && !moxPayload.Meta?.RcptTo)) {
        res.status(400).json({ error: 'Invalid Mox webhook payload' });
        return;
      }

      const email = transformMoxPayload(moxPayload);

      if (!email.from || !email.to) {
        res.status(400).json({ error: 'Could not resolve sender or recipient from Mox payload' });
        return;
      }

      const result = await processIncomingEmail(ctx, email);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof PipelineError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('[mox-webhook] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
