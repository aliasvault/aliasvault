import { EventEmitter } from 'fbemitter';

/**
 * Create a new event emitter instance which is used by the app
 * to communicate between components.
 */
const emitter = new EventEmitter();
export default emitter;
