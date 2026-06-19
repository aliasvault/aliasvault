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
    title: 'Zero-Knowledge Encryption',
    description:
      'Your entire vault is encrypted client-side before it reaches the server. Your master password never leaves your device.',
  },
  {
    emoji: '📧',
    title: 'Built-in Email Server',
    description:
      'Generate virtual email addresses for each identity. Emails sent to these addresses are instantly visible in the AliasVault app.',
  },
  {
    emoji: '🎭',
    title: 'Virtual Identities',
    description:
      'Create separate identities for different purposes, each with its own email aliases.',
  },
  {
    emoji: '🏠',
    title: 'Self-Hosted',
    description:
      'Run AliasVault on your own infrastructure with Docker: a managed install script or a single all-in-one container.',
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
    <section className={styles.section}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Key Features
        </Heading>
        <p className={styles.sectionIntro}>
          Unique features that make AliasVault stand out from other password managers:
        </p>
        <div className="row">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className={clsx('col col--4', styles.feature)}>
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

type DocArea = {
  emoji: string;
  title: string;
  description: string;
  to: string;
};

const DOC_AREAS: DocArea[] = [
  {
    emoji: '🖥️',
    title: 'Self-hosting',
    description: 'Install and run your own AliasVault server with Docker.',
    to: '/installation/',
  },
  {
    emoji: '🧩',
    title: 'Browser extensions',
    description: 'Set up the extension for Chrome, Firefox, Edge or Safari.',
    to: '/installation/browser-extensions/',
  },
  {
    emoji: '📱',
    title: 'Mobile apps',
    description: 'Get AliasVault on iOS and Android.',
    to: '/installation/mobile-apps/',
  },
  {
    emoji: '🏗️',
    title: 'Architecture',
    description: 'Understand how AliasVault is built and secured.',
    to: '/architecture/',
  },
];

function ExploreDocs() {
  return (
    <section className={clsx(styles.section, styles.sectionAlt)}>
      <div className="container">
        <Heading as="h2" className={styles.sectionTitle}>
          Explore the documentation
        </Heading>
        <p className={styles.sectionIntro}>
          Jump straight to what you need, whether you&apos;re setting up a server
          or connecting your apps.
        </p>
        <div className="row">
          {DOC_AREAS.map((area) => (
            <div key={area.title} className={clsx('col col--3', styles.feature)}>
              <Link to={area.to} className={styles.featureCard}>
                <div className={styles.featureEmoji}>{area.emoji}</div>
                <Heading as="h3">{area.title}</Heading>
                <p>{area.description}</p>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GettingStartedAndContribute() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={clsx('row', styles.twoUpRow)}>
          <div className="col col--6">
            <div className={styles.contentCard}>
              <Heading as="h3">🚀 Getting Started</Heading>
              <p>
                Ready to get started with AliasVault? Spin up your own instance
                with Docker in minutes, then connect the browser extension and
                mobile apps.
              </p>
              <p>
                <Link to="/installation/">Read the server installation guide →</Link>
              </p>
            </div>
          </div>
          <div className="col col--6">
            <div className={styles.contentCard}>
              <Heading as="h3">🤝 Want to Contribute?</Heading>
              <p>Help make AliasVault better for everyone:</p>
              <ul>
                <li>
                  <strong>🌍 Translate the UI</strong>: help translate
                  AliasVault into your language.
                </li>
                <li>
                  <strong>👤 Add Name Dictionaries</strong>: provide names for
                  the identity generator.
                </li>
              </ul>
              <p>
                <Link to="/contributing/">See all ways to contribute →</Link>
              </p>
            </div>
          </div>
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
      description="AliasVault: open-source, self-hostable password and identity manager with built-in email aliasing.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <ExploreDocs />
        <GettingStartedAndContribute />
      </main>
    </Layout>
  );
}
