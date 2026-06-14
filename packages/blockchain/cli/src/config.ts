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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
export const currentDir = path.dirname(fileURLToPath(import.meta.url));

const safeTimestamp = () => new Date().toISOString().replace(/:/g, '-');

export const contractConfig = {
    privateStateStoreName: 'counter-private-state',
    zkConfigPath: path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'counter'),
};

export interface Config {
    readonly logDir: string;
    readonly indexer: string;
    readonly indexerWS: string;
    readonly node: string;
    readonly proofServer: string;
}

export class StandaloneConfig implements Config {
    logDir = path.resolve(currentDir, '..', 'logs', 'standalone', `${safeTimestamp()}.log`);
    indexer = 'http://127.0.0.1:8088/api/v4/graphql';
    indexerWS = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
    node = 'http://127.0.0.1:9944';
    proofServer = 'http://127.0.0.1:6300';
    constructor() {
        setNetworkId('undeployed');
    }
}

export class PreviewConfig implements Config {
    logDir = path.resolve(currentDir, '..', 'logs', 'preview', `${safeTimestamp()}.log`);
    indexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
    indexerWS = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
    node = 'https://rpc.preview.midnight.network';
    proofServer = 'http://127.0.0.1:6300';
    constructor() {
        setNetworkId('preview');
    }
}

export class PreprodConfig implements Config {
    logDir = path.resolve(currentDir, '..', 'logs', 'preprod', `${safeTimestamp()}.log`);
    indexer = 'https://indexer.preprod.midnight.network/api/v4/graphql';
    indexerWS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws';
    node = 'https://rpc.preprod.midnight.network';
    proofServer = 'http://127.0.0.1:6300';
    constructor() {
        setNetworkId('preprod');
    }
}
