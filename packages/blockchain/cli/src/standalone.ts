// This file is part of midnightntwrk/example-counter.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createLogger } from './logger-utils.js';
import path from 'node:path';
import { run } from './cli.js';
import { DockerComposeEnvironment, Wait } from 'testcontainers';
import { currentDir, StandaloneConfig } from './config.js';

const config = new StandaloneConfig();
const dockerEnv = new DockerComposeEnvironment(path.resolve(currentDir, '..'), 'standalone.yml')
  .withWaitStrategy('counter-proof-server', Wait.forLogMessage('Actix runtime found; starting in Actix runtime', 1))
  .withWaitStrategy('counter-indexer', Wait.forLogMessage(/starting indexing/, 1));
const logger = await createLogger(config.logDir);
await run(config, logger, dockerEnv);
