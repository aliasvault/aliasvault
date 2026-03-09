import express from 'express';
import { createEmailRouter } from './routes/email.js';
import { createMoxWebhookRouter } from './routes/moxWebhook.js';
import { createHealthRouter } from './routes/health.js';
import { metricsHandler } from './metrics.js';
import type { BridgeContext } from './types/context.js';

export function createApp(ctx: BridgeContext) {
  const app = express();

  app.use(express.json({ limit: '5mb' }));

  app.use(createHealthRouter(ctx));
  app.use(createEmailRouter(ctx));
  app.use(createMoxWebhookRouter(ctx));
  app.get('/metrics', metricsHandler);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
