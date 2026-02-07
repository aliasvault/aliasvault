// Direct-connect TUI for an already-running local Midnight network.
// Use this when you have bricktowers/midnight-local-network (or standalone.yml)
// already running via Docker Compose externally.
//
// No Docker containers are started by this script.

import { createLogger } from './logger-utils.js';
import { run } from './cli.js';
import { StandaloneConfig } from './config.js';

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
await run(config, logger);
