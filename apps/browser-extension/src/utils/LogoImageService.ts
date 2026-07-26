/**
 * Prepares user-supplied images for storage as item logos.
 */

const LOGO_MAX_SIZE = 128;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'];

/**
 * The result of preparing an image for storage.
 */
export type PreparedLogo = {
  data: Uint8Array;
  mimeType: string;
};

/**
 * Error thrown when an upload cannot be turned into a logo. The `reason` maps to a translation key
 * so the UI can explain what went wrong.
 */
export class LogoImageError extends Error {
  /**
   * Create an error describing why an upload cannot become a logo.
   * @param reason Why the image was rejected; maps to a translation key.
   */
  public constructor(public readonly reason: 'tooLarge' | 'unsupportedType' | 'decodeFailed') {
    super(reason);
    this.name = 'LogoImageError';
  }
}

/**
 * Service for turning uploaded image files into stored logo bytes.
 */
export class LogoImageService {
  /**
   * The `accept` attribute for the file picker, matching what prepare() can decode.
   * @returns A comma-separated MIME type list
   */
  public static get acceptAttribute(): string {
    return ACCEPTED_MIME_TYPES.join(',');
  }

  /**
   * Decode, scale and re-encode an uploaded file as a square-fitting PNG.
   * @param file The file the user picked
   * @returns The logo bytes to store
   * @throws LogoImageError when the file is too large, of an unsupported type, or undecodable
   */
  public static async prepare(file: File): Promise<PreparedLogo> {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new LogoImageError('tooLarge');
    }
    if (file.type && !ACCEPTED_MIME_TYPES.includes(file.type)) {
      throw new LogoImageError('unsupportedType');
    }

    const image = await LogoImageService.loadImage(file);
    const scale = Math.min(1, LOGO_MAX_SIZE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new LogoImageError('decodeFailed');
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new LogoImageError('decodeFailed');
    }

    return { data: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png' };
  }

  /**
   * Decode a file into an image element. Going through an object URL rather than createImageBitmap
   * keeps .ico and .svg working.
   * @param file The file to decode
   * @returns The loaded image
   */
  private static loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();

      /**
       * Release the object URL once the browser is done with it, either way.
       */
      const cleanup = (): void => URL.revokeObjectURL(objectUrl);

      /**
       * The browser decoded the file: hand the image over.
       */
      image.onload = () : void => {
        cleanup();
        resolve(image);
      };

      /**
       * The browser could not decode the file (corrupt, or a type it does not support).
       */
      image.onerror = () : void => {
        cleanup();
        reject(new LogoImageError('decodeFailed'));
      };
      image.src = objectUrl;
    });
  }
}
