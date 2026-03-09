import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { BridgeContext } from '../types/context.js';
import type { IncomingEmail } from '../types/email.js';
import { webhookAuth } from '../middleware/auth.js';
import { processIncomingEmail, extractLocalPart, PipelineError } from '../services/emailPipeline.js';

const MAX_EMAIL_SIZE = 5 * 1024 * 1024; // 5MB

export function createEmailRouter(ctx: BridgeContext): Router {
  const router = Router();

  // Per-alias rate limiter: 100 req/min
  const aliasLimiter = rateLimit({
    windowMs: 60_000,
    max: ctx.config.rateLimitPerAlias,
    keyGenerator: (req) => {
      const body = req.body as IncomingEmail;
      const localPart = body?.to ? extractLocalPart(body.to) : 'unknown';
      return localPart ?? 'unknown';
    },
    message: { error: 'Rate limit exceeded for this alias' },
  });

  router.post('/receive-email', webhookAuth(ctx), aliasLimiter, async (req, res) => {
    try {
      const body = req.body as IncomingEmail;

      // Validate required fields
      if (!body.to || !body.from || !body.subject || !body.body) {
        res.status(400).json({ error: 'Missing required fields: to, from, subject, body' });
        return;
      }

      // Check size
      const bodySize = JSON.stringify(body).length;
      if (bodySize > MAX_EMAIL_SIZE) {
        res.status(413).json({ error: `Email exceeds maximum size of 5MB` });
        return;
      }

      const result = await processIncomingEmail(ctx, body);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof PipelineError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error('[receive-email] Unexpected error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
