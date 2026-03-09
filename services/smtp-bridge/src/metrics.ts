import client from 'prom-client';
import type { Request, Response } from 'express';

// Collect default Node.js metrics
client.collectDefaultMetrics();

export const emailsReceived = new client.Counter({
  name: 'emails_received_total',
  help: 'Total number of emails received by the bridge',
});

export const encryptionErrors = new client.Counter({
  name: 'encryption_errors_total',
  help: 'Total number of email encryption failures',
});

export const txErrors = new client.Counter({
  name: 'tx_errors_total',
  help: 'Total number of contract transaction errors',
});

export const rpcDuration = new client.Histogram({
  name: 'rpc_duration_seconds',
  help: 'Duration of RPC calls in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set('Content-Type', client.register.contentType);
  const metrics = await client.register.metrics();
  res.end(metrics);
}
