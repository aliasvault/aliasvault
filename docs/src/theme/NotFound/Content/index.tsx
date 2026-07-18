import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Translate from '@docusaurus/Translate';
import type {Props} from '@theme/NotFound/Content';
import Heading from '@theme/Heading';

export default function NotFoundContent({className}: Props): ReactNode {
  return (
    <main className={clsx('container margin-vert--xl', className)}>
      <div className="row">
        <div className="col col--8 col--offset-2">
          <Heading as="h1" className="hero__title">
            <Translate id="theme.NotFound.title">
              Page not found
            </Translate>
          </Heading>
          <p>
            <Translate id="theme.NotFound.p1">
              We couldn&apos;t find that page. It may have moved as the docs were
              reorganized, or the link that brought you here is out of date.
            </Translate>
          </p>
          <p>
            <Translate id="theme.NotFound.p2">
              Try one of these instead:
            </Translate>
          </p>
          <ul>
            <li>
              <Link to="/">Documentation home</Link>
            </li>
            <li>
              <Link to="/installation/">Self-host install guide</Link>
            </li>
            <li>
              <Link to="/installation/browser-extensions/">Browser extensions</Link>
            </li>
            <li>
              <Link to="/installation/mobile-apps/">Mobile apps</Link>
            </li>
            <li>
              <Link to="/contributing/">Contributing</Link>
            </li>
          </ul>
          <p>
            Still stuck? Open an issue on{' '}
            <Link href="https://github.com/aliasvault/aliasvault/issues">
              GitHub
            </Link>{' '}
            or reach out via the <Link to="/contact/">contact</Link>{' '}
            page.
          </p>
          <div className="margin-top--lg">
            <Link className="button button--primary button--lg" to="/">
              Back to the docs
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
