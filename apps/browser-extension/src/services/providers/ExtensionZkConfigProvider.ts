/**
 * ZK config provider that loads artifacts from bundled extension resources.
 *
 * Replaces FetchZkConfigProvider which rejects chrome-extension:// URLs.
 * Implements the same ZKConfigProvider interface: getProverKey, getVerifierKey, getZKIR.
 *
 * File layout matches FetchZkConfigProvider expectations:
 *   keys/{circuitId}.prover   — prover key
 *   keys/{circuitId}.verifier — verifier key
 *   zkir/{circuitId}.bzkir    — ZK intermediate representation
 */

export class ExtensionZkConfigProvider {
  private readonly fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? fetch.bind(globalThis);
  }

  async getProverKey(circuitId: string): Promise<Uint8Array> {
    return this.fetchArtifact(`keys/${circuitId}.prover`);
  }

  async getVerifierKey(circuitId: string): Promise<Uint8Array> {
    return this.fetchArtifact(`keys/${circuitId}.verifier`);
  }

  async getZKIR(circuitId: string): Promise<Uint8Array> {
    return this.fetchArtifact(`zkir/${circuitId}.bzkir`);
  }

  async getVerifierKeys(circuitIds: string[]): Promise<[string, Uint8Array][]> {
    return Promise.all(
      circuitIds.map(async (id) => [id, await this.getVerifierKey(id)] as [string, Uint8Array]),
    );
  }

  async get(circuitId: string): Promise<{ proverKey: Uint8Array; verifierKey: Uint8Array; zkir: Uint8Array }> {
    const [proverKey, verifierKey, zkir] = await Promise.all([
      this.getProverKey(circuitId),
      this.getVerifierKey(circuitId),
      this.getZKIR(circuitId),
    ]);
    return { proverKey, verifierKey, zkir };
  }

  private async fetchArtifact(path: string): Promise<Uint8Array> {
    const url = chrome.runtime.getURL(path);
    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ZK artifact ${path}: HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }
}
