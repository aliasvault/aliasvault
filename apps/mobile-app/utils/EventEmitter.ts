import { EventEmitter } from 'fbemitter';

import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * Payload of `itemChanged` for one item: where it was, and where it is now (absent once it is trashed).
 */
export type ItemChangedEvent = { previous: ItemRef; current?: ItemRef };

/**
 * Create a new event emitter instance which is used by the app
 * to communicate between components.
 */
const emitter = new EventEmitter();
export default emitter;
