import { PinataSDK } from 'pinata';
import type { IpfsProvider, PinataProviderConfig } from '../types.js';
import { IpfsError, IpfsErrorCodes } from '../errors.js';

/**
 * Pinata implementation of IpfsProvider.
 * Thin wrapper around the Pinata SDK — validation/retry handled by IpfsService.
 */
export class PinataProvider implements IpfsProvider {
  private readonly pinata: PinataSDK;

  constructor(config: PinataProviderConfig) {
    if (!config.pinataJwt) {
      throw new Error('PinataProvider: pinataJwt is required');
    }
    if (!config.pinataGateway) {
      throw new Error('PinataProvider: pinataGateway is required');
    }
    this.pinata = new PinataSDK({
      pinataJwt: config.pinataJwt,
      pinataGateway: config.pinataGateway,
    });
  }

  /**
   * Upload raw bytes to Pinata. Returns CID string.
   * Converts Uint8Array to Pinata FileObject (SDK-specific type).
   */
  async upload(data: Uint8Array, filename?: string): Promise<string> {
    try {
      const buffer: ArrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const fileObject = {
        name: filename ?? `vault-${Date.now()}.bin`,
        size: data.length,
        type: 'application/octet-stream',
        lastModified: Date.now(),
        arrayBuffer: (): Promise<ArrayBuffer> => Promise.resolve(buffer),
      };
      const result = await this.pinata.upload.file(fileObject);
      return result.cid;
    } catch (error) {
      if (error instanceof IpfsError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('401') || message.includes('Unauthorized') || message.includes('authentication')) {
        throw new IpfsError(
          IpfsErrorCodes.IPFS_AUTH_FAILED,
          'Pinata authentication failed',
          message,
        );
      }
      throw new IpfsError(
        IpfsErrorCodes.IPFS_UPLOAD_FAILED,
        'Failed to upload to Pinata',
        message,
      );
    }
  }

  /**
   * Download blob from Pinata gateway by CID. Returns raw bytes.
   */
  async download(cid: string): Promise<Uint8Array> {
    try {
      const response = await this.pinata.gateways.get(cid);
      const data = response.data;
      if (data instanceof Blob) {
        const buffer = await data.arrayBuffer();
        return new Uint8Array(buffer);
      }
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (data instanceof Uint8Array) {
        return data;
      }
      if (typeof data === 'string') {
        return new TextEncoder().encode(data);
      }
      throw new IpfsError(
        IpfsErrorCodes.IPFS_DOWNLOAD_FAILED,
        'Unexpected response type from Pinata gateway',
        `Received: ${typeof data}`,
      );
    } catch (error) {
      if (error instanceof IpfsError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('401') || message.includes('Unauthorized')) {
        throw new IpfsError(
          IpfsErrorCodes.IPFS_AUTH_FAILED,
          'Pinata authentication failed',
          message,
        );
      }
      throw new IpfsError(
        IpfsErrorCodes.IPFS_DOWNLOAD_FAILED,
        'Failed to download from Pinata',
        message,
      );
    }
  }
}
