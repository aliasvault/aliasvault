/**
 * A platform service that refuses every call, for hosts that do not provide it.
 * @param what - the service name, for the error message
 */
export function unavailableService<T extends object>(what: string): T {
  return new Proxy({} as T, {
    /** Throws an error when the service is accessed. */
    get: (_target, property): unknown => (): Promise<never> => Promise.reject(new Error(`No ${what} configured for this platform (${String(property)}).`)),
  });
}
