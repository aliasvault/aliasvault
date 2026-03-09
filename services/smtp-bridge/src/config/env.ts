function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  }
  return parsed;
}

export function loadEnv() {
  return {
    // Midnight Network
    networkId: optional('MIDNIGHT_NETWORK_ID', 'preprod') as 'preprod' | 'testnet' | 'mainnet',
    indexerUrl: required('INDEXER_URL'),
    indexerWsUrl: required('INDEXER_WS_URL'),
    proofServerUrl: required('PROOF_SERVER_URL'),
    nodeUrl: required('NODE_URL'),

    // Wallet
    walletSeed: required('WALLET_SEED'),

    // Relay
    relaySecretKey: required('RELAY_SECRET_KEY'),

    // IPFS / Pinata
    pinataJwt: required('PINATA_JWT'),
    pinataGateway: required('PINATA_GATEWAY'),

    // Webhook Auth
    webhookSecret: required('BRIDGE_WEBHOOK_SECRET'),

    // Service
    port: optionalInt('PORT', 3000),
    batchWindowMs: optionalInt('BATCH_WINDOW_MS', 30_000),
    rateLimitPerAlias: optionalInt('RATE_LIMIT_PER_ALIAS', 100),

    // Contract
    vaultRegistryZkConfigPath: optional('VAULT_REGISTRY_ZK_CONFIG_PATH', './dist/managed/vault-registry'),
    aliasRegistryAddress: required('ALIAS_REGISTRY_ADDRESS'),

    // Mox Webapi (optional — MVP: attachments skipped)
    moxWebapiUrl: process.env.MOX_WEBAPI_URL ?? '',
    moxWebapiPassword: process.env.MOX_WEBAPI_PASSWORD ?? '',
  };
}

export type EnvConfig = ReturnType<typeof loadEnv>;
