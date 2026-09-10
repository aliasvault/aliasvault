/**
 * How the host app identifies itself to the server and to the core.
 */
export interface IAppIdentity {
  /** The app version, e.g. `0.31.0-alpha`. */
  version: string;

  /** The client name sent in the `X-AliasVault-Client` header, e.g. `chrome`, `ios`, `web`. */
  clientName: string;

  /** True for development builds; enables dev-only diagnostics such as stage timers. */
  isDevelopment: boolean;
}
