/*
 * JSON reader utility.
 */

/**
 * A JSON object.
 */
export type JsonObject = Record<string, unknown>;

/**
 * Raised when JSON text cannot be parsed or a value does not have the expected type.
 */
export class JsonException extends Error {
  /**
   * Create the exception.
   * @param message - What went wrong
   */
  public constructor(message: string) {
    super(message);
    this.name = 'JsonException';
    Object.setPrototypeOf(this, JsonException.prototype);
  }
}

/**
 * Parse JSON text.
 * @param text - The JSON text
 * @returns The parsed value
 * @throws {JsonException} When the text is not valid JSON.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new JsonException(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Whether a value is a JSON object (not null, not an array).
 * @param value - The value
 * @returns True for an object
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Look up a property by name.
 * @param obj - The object
 * @param name - The property name
 * @returns The value, or undefined when absent
 */
export function getProperty(obj: JsonObject, name: string): unknown {
  if (name in obj) {
    return obj[name];
  }
  const lower = name.toLowerCase();
  const key = Object.keys(obj).find(k => k.toLowerCase() === lower);
  return key === undefined ? undefined : obj[key];
}

/**
 * Follow a path of property names and return the string at its end, without throwing.
 * @param value - The value to start from
 * @param path - The property names to follow
 * @returns The string, or null when the path does not lead to a string
 */
export function readStringAtPath(value: unknown, ...path: string[]): string | null {
  let current = value;
  for (const name of path) {
    if (!isJsonObject(current)) {
      return null;
    }
    current = getProperty(current, name);
  }
  return typeof current === 'string' ? current : null;
}

/**
 * Read a string property.
 * @param obj - The object
 * @param name - The property name
 * @returns The string, or null when absent or null
 * @throws {JsonException} When the value is not a string.
 */
export function readString(obj: JsonObject, name: string): string | null {
  const value = getProperty(obj, name);
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new JsonException(`Property '${name}' is not a string`);
  }
  return value;
}

/**
 * Read a number property.
 * @param obj - The object
 * @param name - The property name
 * @returns The number, or null when absent or null
 * @throws {JsonException} When the value is not a number.
 */
export function readNumber(obj: JsonObject, name: string): number | null {
  const value = getProperty(obj, name);
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number') {
    throw new JsonException(`Property '${name}' is not a number`);
  }
  return value;
}

/**
 * Read a boolean property.
 * @param obj - The object
 * @param name - The property name
 * @returns The boolean, or null when absent or null
 * @throws {JsonException} When the value is not a boolean.
 */
export function readBoolean(obj: JsonObject, name: string): boolean | null {
  const value = getProperty(obj, name);
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'boolean') {
    throw new JsonException(`Property '${name}' is not a boolean`);
  }
  return value;
}

/**
 * Read an object property.
 * @param obj - The object
 * @param name - The property name
 * @returns The object, or null when absent or null
 * @throws {JsonException} When the value is not an object.
 */
export function readObject(obj: JsonObject, name: string): JsonObject | null {
  const value = getProperty(obj, name);
  if (value === undefined || value === null) {
    return null;
  }
  if (!isJsonObject(value)) {
    throw new JsonException(`Property '${name}' is not an object`);
  }
  return value;
}

/**
 * Read an array property.
 * @param obj - The object
 * @param name - The property name
 * @returns The array, or null when absent or null
 * @throws {JsonException} When the value is not an array.
 */
export function readArray(obj: JsonObject, name: string): unknown[] | null {
  const value = getProperty(obj, name);
  if (value === undefined || value === null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new JsonException(`Property '${name}' is not an array`);
  }
  return value;
}

/**
 * Read an array of objects, mapping each element.
 * @param obj - The object
 * @param name - The property name
 * @param map - Maps one element
 * @returns The mapped elements, or null when the property is absent or null
 * @throws {JsonException} When an element is not an object.
 */
export function readObjectArray<T>(obj: JsonObject, name: string, map: (element: JsonObject) => T): T[] | null {
  const array = readArray(obj, name);
  if (array === null) {
    return null;
  }
  return array.map((element, index) => {
    if (!isJsonObject(element)) {
      throw new JsonException(`Element ${index} of '${name}' is not an object`);
    }
    return map(element);
  });
}

/**
 * Read an array of strings; null elements are kept as null.
 * @param obj - The object
 * @param name - The property name
 * @returns The strings, or null when the property is absent or null
 * @throws {JsonException} When an element is neither a string nor null.
 */
export function readStringArray(obj: JsonObject, name: string): (string | null)[] | null {
  const array = readArray(obj, name);
  if (array === null) {
    return null;
  }
  return array.map((element, index) => {
    if (element === null) {
      return null;
    }
    if (typeof element !== 'string') {
      throw new JsonException(`Element ${index} of '${name}' is not a string`);
    }
    return element;
  });
}

/**
 * Require an object, for the root of a document or an array element.
 * @param value - The value
 * @param what - What the value is, for the error message
 * @returns The object
 * @throws {JsonException} When the value is not an object.
 */
export function requireObject(value: unknown, what: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new JsonException(`${what} is not a JSON object`);
  }
  return value;
}
