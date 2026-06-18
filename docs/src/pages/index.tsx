import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type Feature = {
  emoji: string;
  title: string;
  description: ReactNode;
};

const FEATURES: Feature[] = [
  {
    emoji: '🔐',
    title: 'Secure Passwords',
    description:
      'Store and manage passwords with zero-knowledge, client-side encryption. Your master password never leaves your device.',
  },
  {
    emoji: '📧',
    title: 'Email Aliases',
    description:
      'Generate a unique email address for every service using the built-in email server, and read messages straight from the app.',
  },
  {
    emoji: '🎭',
    title: 'Virtual Identities',
    description:
      'Create and manage separate online identities, each with its own aliases, for different purposes.',
  },
  {
    emoji: '🏠',
    title: 'Self-Hosted',
    description:
      'Run AliasVault on your own infrastructure with Docker — a managed install script or a single all-in-one container.',
  },
  {
    emoji: '🔓',
    title: 'Open Source',
    description:
      'Transparent, auditable, and free to use. The full stack is open source on GitHub.',
  },
  {
    emoji: '🔑',
    title: 'Passkeys & 2FA',
    description:
      'A built-in WebAuthn authenticator stores passkeys in your vault and syncs them across all your devices.',
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title} Documentation
        </Heading>
        <p className={styles.heroSubtitle}>
          A privacy-first password manager with built-in email aliasing. Fully
          encrypted and self-hostable.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/installation/">
            Self-host Install
          </Link>
          <Link
            className="button button--secondary button--outline button--lg"
            href="https://github.com/aliasvault/aliasvault">
            View on GitHub
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FEATURES.map((feature) => (
            <div key={feature.title} className={clsx('col col--4', styles.feature)}>
              <div className={styles.featureCard}>
                <div className={styles.featureEmoji}>{feature.emoji}</div>
                <Heading as="h3">{feature.title}</Heading>
                <p>{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} Documentation`}
      description="AliasVault — open-source, self-hostable password and identity manager with built-in email aliasing.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <section className={styles.cta}>
          <div className="container">
            <Heading as="h2">Ready to get started?</Heading>
            <p>
              Spin up your own AliasVault instance with Docker in minutes, then
              connect the browser extension and mobile apps.
            </p>
            <div className={styles.buttons}>
              <Link className="button button--primary button--lg" to="/installation/">
                Read the install guide
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
