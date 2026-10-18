import React, {type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

/** A section a point links to. */
type WhitepaperRef = {
  /** Section number as shown in the whitepaper, e.g. "4.1". Omitted for pages without numbered sections. */
  section?: string;
  label: string;
  /** Heading anchor on the target page, without the leading '#'. */
  anchor?: string;
};

/** A small "Whitepaper §4 Key derivation →" line linking to the sections behind a point; `title` and `path` point it at another docs page. */
export default function WhitepaperRefs({refs, title = 'Whitepaper', path = '/security-whitepaper/'}: {refs: WhitepaperRef[]; title?: string; path?: string}): ReactNode {
  return (
    <span className={styles.refs}>
      <span className={styles.label}>{title}</span>
      {refs.map((ref) => (
        <Link key={ref.anchor ?? ref.label} className={styles.ref} to={ref.anchor ? `${path}#${ref.anchor}` : path}>
          {ref.section && <><span className={styles.section}>§{ref.section}</span> </>}{ref.label} →
        </Link>
      ))}
    </span>
  );
}
