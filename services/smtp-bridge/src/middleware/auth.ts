import type { Request, Response, NextFunction } from 'express';
import type { BridgeContext } from '../types/context.js';

/**
 * Webhook authentication middleware.
 * Validates Bearer token from Authorization header against BRIDGE_WEBHOOK_SECRET.
 */
export function webhookAuth(ctx: BridgeContext) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== ctx.config.webhookSecret) {
      res.status(403).json({ error: 'Invalid webhook secret' });
      return;
    }

    next();
  };
}
