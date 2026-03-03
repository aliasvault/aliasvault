/**
 * Placeholder base64 image for credentials without a logo.
 */
const placeholderBase64 = 'UklGRjoEAABXRUJQVlA4IC4EAAAwFwCdASqAAIAAPpFCm0olo6Ihp5IraLASCWUA0eb/0s56RrLtCnYfLPiBshdXWMx8j1Ez65f169iA4xUDBTEV6ylMQeCIj2b7RngGi7gKZ9WjKdSoy9R8JcgOmjCMlDmLG20KhNo/i/Dc/Ah5GAvGfm8kfniV3AkR6fxN6eKwjDc6xrDgSfS48G5uGV6WzQt24YAVlLSK9BMwndzfHnePK1KFchFrL7O3ulB8cGNCeomu4o+l0SrS/JKblJ4WTzj0DAD++lCUEouSfgRKdiV2TiYCD+H+l3tANKSPQFPQuzi7rbvxqGeRmXB9kDwURaoSTTpYjA9REMUi9uA6aV7PWtBNXgUzMLowYMZeos6Xvyhb34GmufswMHA5ZyYpxzjTphOak4ZjNOiz8aScO5ygiTx99SqwX/uL+HSeVOSraHw8IymrMwm+jLxqN8BS8dGcItLlm/ioulqH2j4V8glDgSut+ExkxiD7m8TGPrrjCQNJbRDzpOFsyCyfBZupvp8QjGKW2KGziSZeIWes4aTB9tRmeEBhnUrmTDZQuXcc67Fg82KHrSfaeeOEq6jjuUjQ8wUnzM4Zz3dhrwSyslVz/WvnKqYkr4V/TTXPFF5EjF4rM1bHZ8bK63EfTnK41+n3n4gEFoYP4mXkNH0hntnYcdTqiE7Gn+q0BpRRxnkpBSZlA6Wa70jpW0FGqkw5e591A5/H+OV+60WAo+4Mi+NlsKrvLZ9EiVaPnoEFZlJQx1fA777AJ2MjXJ4KSsrWDWJi1lE8yPs8V6XvcC0chDTYt8456sKXAagCZyY+fzQriFMaddXyKQdG8qBqcdYjAsiIcjzaRFBBoOK9sU+sFY7N6B6+xtrlu3c37rQKkI3O2EoiJOris54EjJ5OFuumA0M6riNUuBf/MEPFBVx1JRcUEs+upEBsCnwYski7FT3TTqHrx7v5AjgFN97xhPTkmVpu6sxRnWBi1fxIRp8eWZeFM6mUcGgVk1WeVb1yhdV9hoMo2TsNEPE0tHo/wvuSJSzbZo7wibeXM9v/rRfKcx7X93rfiXVnyQ9f/5CaAQ4lxedPp/6uzLtOS4FyL0bCNeZ6L5w+AiuyWCTDFIYaUzhwfG+/YTQpWyeZCdQIKzhV+3GeXI2cxoP0ER/DlOKymf1gm+zRU3sqf1lBVQ0y+mK/Awl9bS3uaaQmI0FUyUwHUKP7PKuXnO+LcwDv4OfPT6hph8smc1EtMe5ib/apar/qZ9dyaEaElALJ1KKxnHziuvVl8atk1fINSQh7OtXDyqbPw9o/nGIpTnv5iFmwmWJLis2oyEgPkJqyx0vYI8rjkVEzKc8eQavAJBYSpjMwM193Swt+yJyjvaGYWPnqExxKiNarpB2WSO7soCAZXhS1uEYHryrK47BH6W1dRiruqT0xpLih3MXiwU3VDwAAAA==';

/**
 * Convert various binary data formats to Uint8Array.
 */
function toUint8Array(buffer: Uint8Array | number[] | {[key: number]: number}): Uint8Array {
  if (buffer instanceof Uint8Array) {
    return buffer;
  }

  if (Array.isArray(buffer)) {
    return new Uint8Array(buffer);
  }

  const length = Object.keys(buffer).length;
  const arr = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = buffer[i];
  }

  return arr;
}

/**
 * Base64 encode binary data.
 */
function base64Encode(buffer: Uint8Array | number[] | {[key: number]: number}): string | null {
  try {
    const arr = Array.from(toUint8Array(buffer));
    return btoa(arr.reduce((data, byte) => data + String.fromCharCode(byte), ''));
  } catch (error) {
    console.error('Error encoding to base64:', error);
    return null;
  }
}

/**
 * Detect MIME type from file signature (magic numbers).
 */
function detectMimeType(bytes: Uint8Array): string {
  const isSvg = () : boolean => {
    const header = new TextDecoder().decode(bytes.slice(0, 5)).toLowerCase();
    return header.includes('<?xml') || header.includes('<svg');
  };

  const isIco = () : boolean => {
    return bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  };

  const isPng = () : boolean => {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
  };

  if (isSvg()) {
    return 'image/svg+xml';
  }
  if (isIco()) {
    return 'image/x-icon';
  }
  if (isPng()) {
    return 'image/png';
  }

  return 'image/x-icon';
}

/**
 * Convert binary logo data to a base64 encoded image source string.
 */
export function imgSrcFromBytes(bytes: Uint8Array<ArrayBufferLike> | number[] | undefined): string {
  if (bytes) {
    try {
      const logoBytes = toUint8Array(bytes);
      const base64Logo = base64Encode(logoBytes);
      const mimeType = detectMimeType(logoBytes);
      return `data:${mimeType};base64,${base64Logo}`;
    } catch (error) {
      console.error('Error setting logo:', error);
      return `data:image/x-icon;base64,${placeholderBase64}`;
    }
  } else {
    return `data:image/x-icon;base64,${placeholderBase64}`;
  }
}
