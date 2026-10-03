import React from 'react';

/*
 * Markdown renderer for remote documents (e.g. the registration terms and conditions).
 */

/** A link target we are willing to render. */
const SAFE_HREF = /^(https?:|mailto:)/i;

/** Inline tokens: link, bold, italic. */
const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|\*(.+?)\*/g;

/**
 * Render the inline markup of one line of text.
 */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) {
      nodes.push(text.slice(last, index));
    }
    const key = `${keyPrefix}-${index}`;
    const [whole, linkText, href, bold, italic] = match;
    if (linkText !== undefined) {
      nodes.push(SAFE_HREF.test(href) ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-primary-700 dark:text-primary-400 hover:underline">{linkText}</a> : linkText);
    } else if (bold !== undefined) {
      nodes.push(<strong key={key} className="font-semibold text-gray-900 dark:text-white">{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic}</em>);
    } else {
      nodes.push(whole);
    }
    last = index + whole.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes;
}

/**
 * Render a Markdown document as styled React elements.
 */
const Markdown: React.FC<{ content: string }> = ({ content }) => {
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  /**
   * Close the open paragraph or list, if any.
   */
  const flush = (): void => {
    const key = `b${blocks.length}`;
    if (paragraph.length > 0) {
      blocks.push(<p key={key} className="mb-3">{renderInline(paragraph.join(' '), key)}</p>);
      paragraph = [];
    }
    if (list.length > 0) {
      blocks.push(<ul key={key} className="mb-3 ml-5 list-disc space-y-1">{list.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}</ul>);
      list = [];
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const listItem = /^[-*]\s+(.*)$/.exec(line);
    if (line.length === 0 || /^-{3,}$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      const key = `b${blocks.length}`;
      const level = heading[1].length;
      const text = renderInline(heading[2], key);
      if (level === 1) {
        blocks.push(<h3 key={key} className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{text}</h3>);
      } else if (level === 2) {
        blocks.push(<h4 key={key} className="mt-4 mb-2 font-semibold text-gray-900 dark:text-white">{text}</h4>);
      } else {
        blocks.push(<h5 key={key} className="mt-3 mb-1 font-semibold text-gray-900 dark:text-white">{text}</h5>);
      }
    } else if (listItem) {
      if (paragraph.length > 0) {
        flush();
      }
      list.push(listItem[1]);
    } else {
      if (list.length > 0) {
        flush();
      }
      paragraph.push(line);
    }
  }
  flush();

  return <div className="text-sm text-gray-600 dark:text-gray-400">{blocks}</div>;
};

export default Markdown;
