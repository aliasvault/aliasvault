import { Router } from 'express';
import type { BridgeContext } from '../types/context.js';

export function createHealthRouter(ctx: BridgeContext): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const indexerOk = await ctx.checkIndexerHealth();

    const status = ctx.walletReady && indexerOk ? 'ok' : 'degraded';

    res.json({
      status,
      walletReady: ctx.walletReady,
      indexerConnected: indexerOk,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
