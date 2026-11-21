import { describe, expect, it } from 'vitest';

import { readXml, xmlChild, xmlChildren, xmlChildText, XmlException } from '../XmlReader';

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

describe('readXml', () => {
  it('reads elements, attributes, text, CDATA and character references', () => {
    const root = readXml(`${BYTE_ORDER_MARK}<?xml version="1.0" encoding="UTF-8"?>\n<!-- comment --><Root a="1" b='x &gt; y'><Item/><Item>A &amp; B &#233;&#x65E5;&#x1F600; &amp;#233;</Item><Data><![CDATA[<raw> & text]]></Data></Root>`);

    expect(root.Name).toBe('Root');
    expect(root.Attributes).toEqual({ a: '1', b: 'x > y' });
    expect(xmlChildren(root, 'Item').map(item => item.Text)).toEqual(['', 'A & B é日😀 &#233;']);
    expect(xmlChildText(root, 'Data')).toBe('<raw> & text');
    expect(xmlChild(root, 'Missing')).toBeNull();
  });

  it('keeps the text of a value as-is, with line breaks as line feeds', () => {
    const root = readXml('<Value>  line one\r\n\r\nline three; "quoted" \'x\'  </Value>');

    expect(root.Text).toBe('  line one\n\nline three; "quoted" \'x\'  ');
  });

  it('keeps values that look like numbers or booleans as text', () => {
    const root = readXml('<r><Value>0123</Value><Value>1e5</Value><Value>0x1F</Value><Value>-0.50</Value><Value>True</Value><Value Ref="007"/></r>');

    expect(xmlChildren(root, 'Value').map(value => value.Text)).toEqual(['0123', '1e5', '0x1F', '-0.50', 'True', '']);
    expect(xmlChildren(root, 'Value')[5].Attributes).toEqual({ Ref: '007' });
  });

  it('reads an attribute value that holds a ">"', () => {
    expect(readXml('<Value Note="a>b" Ref="0"/>').Attributes).toEqual({ Note: 'a>b', Ref: '0' });
  });

  it('keeps an unknown entity as text', () => {
    expect(readXml('<r>&nbsp;</r>').Text).toBe('&nbsp;');
  });

  it.each([
    ['an entity declaration', '<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>'],
    ['an external entity', '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>'],
    ['a mismatched end tag', '<a><b></a></b>'],
    ['an unclosed element', '<a><b></b>'],
    ['a second root element', '<a/><b/>'],
    ['text outside the root element', 'text<a/>'],
    ['text after the root element', '<a></a>text'],
    ['a malformed attribute', '<a b=c/>'],
    ['no element', '<!-- comment -->'],
  ])('rejects %s', (_, xml) => {
    expect(() => readXml(xml)).toThrow(XmlException);
  });
});
