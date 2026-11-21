/*
 * XML reader which uses fast-xml-parser with custom settings for as-is imports.
 */
import { ENTITY_ACTION, EntityDecoder } from '@nodable/entities';
import { XMLParser } from 'fast-xml-parser';

import type { EntityHookAction } from '@nodable/entities';

/**
 * An element with its attributes, child elements and the text directly inside it.
 */
export type XmlElement = {
  Name: string;
  Attributes: Record<string, string>;
  Children: XmlElement[];
  Text: string;
};

/**
 * Raised when text is not XML this reader accepts.
 */
export class XmlException extends Error {
  /**
   * Create the exception.
   * @param message - What is wrong
   */
  public constructor(message: string) {
    super(message);
    this.name = 'XmlException';
    Object.setPrototypeOf(this, XmlException.prototype);
  }
}

/** A node of the parser's ordered output: one element name mapped to its children, or a text node. */
type ParsedNode = Record<string, unknown>;

const ATTRIBUTES_KEY = ':@';
const TEXT_KEY = '#text';

/**
 * Read an XML document.
 * @param text - The document
 * @returns The root element
 * @throws {XmlException} When the document is malformed or declares an entity.
 */
export function readXml(text: string): XmlElement {
  let nodes: ParsedNode[];
  try {
    const parser = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: '',
      // Keep values as text: no number parsing, no trimming.
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
      // The default decoder skips numeric references and expands DOCTYPE entities.
      entityDecoder: new EntityDecoder({ numericAllowed: true, onInputEntity: rejectEntityDeclaration }),
    });
    nodes = parser.parse(text.replace(/^\uFEFF/, ''), true) as ParsedNode[];
  } catch (error) {
    throw new XmlException(error instanceof Error ? error.message : String(error));
  }

  if (nodes.some(node => typeof node[TEXT_KEY] === 'string' && node[TEXT_KEY].trim().length > 0)) {
    throw new XmlException('Text outside the root element');
  }
  const elements = nodes.filter(node => !(TEXT_KEY in node));
  if (elements.length !== 1) {
    throw new XmlException(elements.length === 0 ? 'The document has no root element' : 'More than one root element');
  }
  return toElement(elements[0]);
}

/**
 * Reject an entity declared in the document.
 * @returns The action that makes the parser throw
 */
function rejectEntityDeclaration(): EntityHookAction {
  return ENTITY_ACTION.THROW;
}

/**
 * Convert a parsed element node.
 * @param node - The node
 * @returns The element
 */
function toElement(node: ParsedNode): XmlElement {
  const name = Object.keys(node).find(key => key !== ATTRIBUTES_KEY)!;
  const element: XmlElement = { Name: name, Attributes: (node[ATTRIBUTES_KEY] as Record<string, string> | undefined) ?? {}, Children: [], Text: '' };
  for (const child of node[name] as ParsedNode[]) {
    if (TEXT_KEY in child) {
      element.Text += child[TEXT_KEY] as string;
    } else {
      element.Children.push(toElement(child));
    }
  }
  return element;
}

/**
 * The first child element with a name.
 * @param element - The parent
 * @param name - The child name
 * @returns The child, or null
 */
export function xmlChild(element: XmlElement | null | undefined, name: string): XmlElement | null {
  return element?.Children.find(child => child.Name === name) ?? null;
}

/**
 * The child elements with a name.
 * @param element - The parent
 * @param name - The child name
 * @returns The children
 */
export function xmlChildren(element: XmlElement | null | undefined, name: string): XmlElement[] {
  return element?.Children.filter(child => child.Name === name) ?? [];
}

/**
 * The text of the first child element with a name.
 * @param element - The parent
 * @param name - The child name
 * @returns The text, or null when there is no such child
 */
export function xmlChildText(element: XmlElement | null | undefined, name: string): string | null {
  return xmlChild(element, name)?.Text ?? null;
}
