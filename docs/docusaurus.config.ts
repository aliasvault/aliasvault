import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

try {
  process.loadEnvFile();
} catch {
  // No `.env` file present; fall back to the ambient environment.
}

const analyticsScript = process.env.ANALYTICS_SCRIPT;

const config: Config = {
  title: 'AliasVault',
  tagline: 'A privacy-first password manager with built-in email aliasing',
  favicon: 'assets/img/favicon.png',

  // Load the Inter webfont from the document <head> with preconnect, instead of
  // a render-blocking `@import` in custom.css. `@import` of a remote stylesheet
  // serializes requests (CSS -> font CSS -> font files) and delays first paint;
  // discovering the <link> in the initial HTML + warming the gstatic connection
  // improves LCP (a Core Web Vitals ranking signal). `display=swap` avoids FOIT.
  headTags: [
    {
      tagName: 'link',
      attributes: {rel: 'preconnect', href: 'https://fonts.googleapis.com'},
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: 'anonymous',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap',
      },
    },
  ],

  url: 'https://docs.aliasvault.com',
  baseUrl: '/',

  // Emit every internal link and page output with a trailing slash so the
  // canonical URL is hit directly. Without this, links like /architecture or
  // /installation/script resolve to a directory and the server issues a 301 to
  // add the slash which can remove a custom non 80/443 port from the URL.
  trailingSlash: true,

  organizationName: 'aliasvault',
  projectName: 'aliasvault',

  onBrokenLinks: 'throw',

  // Treat .md as CommonMark (lenient) and .mdx as MDX. This keeps the large
  // body of migrated Markdown (shell snippets, angle brackets, braces) parsing
  // without JSX escaping issues, while still allowing MDX where we opt in.
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/aliasvault/aliasvault/tree/main/docs/',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
          // Emit <lastmod> (from git history, via showLastUpdateTime) so
          // crawlers can tell which pages changed and re-crawl them sooner.
          lastmod: 'datetime',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      // Redirects old jekyll pages to the new docusaurus pages, as well as handling redirects for future moved pages.
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          {
            to: '/installation/docker-compose/',
            from: [
              '/installation/advanced/manual-setup',
              '/installation/advanced/manual-setup.html',
            ],
          },
          {
            to: '/installation/script/',
            from: ['/installation/install', '/installation/install.html'],
          },
          {
            to: '/installation/script/troubleshooting',
            from: [
              '/installation/troubleshooting',
              '/installation/troubleshooting.html',
            ],
          },
          {
            to: '/installation/script/update/',
            from: ['/installation/update', '/installation/update.html'],
          },
          {
            to: '/installation/script/update/v0.22.0',
            from: [
              '/installation/update/v0.22.0',
              '/installation/update/v0.22.0.html',
            ],
          },
          {
            to: '/installation/script/update/v0.23.0',
            from: [
              '/installation/update/v0.23.0',
              '/installation/update/v0.23.0.html',
            ],
          },
          // private-vs-public-email moved from /misc into /installation, then
          // again under the /installation/docs/ category.
          {
            to: '/installation/docs/private-vs-public-email',
            from: [
              '/installation/private-vs-public-email',
              '/installation/private-vs-public-email.html',
              '/misc/private-vs-public-email',
              '/misc/private-vs-public-email.html',
            ],
          },
          // The /misc landing and dev/release docs were removed; point any
          // stale links at the closest surviving pages.
          {
            to: '/',
            from: ['/misc', '/misc.html'],
          },
          {
            to: '/contributing/development/',
            from: [
              '/misc/dev/release',
              '/misc/dev/release.html',
              '/misc/dev/release/git-versioning-strategy',
              '/misc/dev/release/git-versioning-strategy.html',
              '/misc/dev/release/manual-versioning',
              '/misc/dev/release/manual-versioning.html',
              '/misc/dev/release/release-checklist',
              '/misc/dev/release/release-checklist.html',
            ],
          },
          // The Linux/macOS and Windows dev pages were merged into a single
          // "development-setup" page.
          {
            to: '/contributing/development/development-setup',
            from: [
              '/contributing/development/linux-macos-development',
              '/misc/dev/linux-macos-development',
              '/misc/dev/linux-macos-development.html',
              '/contributing/development/windows-development',
              '/misc/dev/windows-development',
              '/misc/dev/windows-development.html',
            ],
          },
          // Dev database operations is covered by the self-host install docs.
          {
            to: '/installation/script/advanced/database',
            from: [
              '/contributing/development/database-operations',
              '/misc/dev/database-operations',
              '/misc/dev/database-operations.html',
            ],
          },
          {
            to: '/contributing/development/',
            from: [
              '/contributing/development/add-new-language',
              '/misc/dev/add-new-language',
              '/misc/dev/add-new-language.html',
              '/contributing/development/upgrade-ef-client-model',
              '/misc/dev/upgrade-ef-client-model',
              '/misc/dev/upgrade-ef-client-model.html',
              '/contributing/development/upgrade-ef-server-model',
              '/misc/dev/upgrade-ef-server-model',
              '/misc/dev/upgrade-ef-server-model.html',
            ],
          },
        ],
        // Sections that moved keep their old URLs working. Each entry maps a
        // new path prefix back to where it used to live:
        //   - /misc/dev/* tree            → /contributing/development/*
        //   - /browser-extensions/*       → /installation/browser-extensions/*
        //   - /mobile-apps/*              → /installation/mobile-apps/*
        createRedirects(existingPath) {
          const moves: [string, string][] = [
            ['/contributing/development', '/misc/dev'],
            ['/installation/browser-extensions', '/browser-extensions'],
            ['/installation/mobile-apps', '/mobile-apps'],
          ];
          for (const [newPrefix, oldPrefix] of moves) {
            if (existingPath.startsWith(newPrefix)) {
              const oldPath = existingPath.replace(newPrefix, oldPrefix);
              // Directory/index routes end with "/"; don't append ".html" there.
              return oldPath.endsWith('/')
                ? [oldPath]
                : [oldPath, `${oldPath}.html`];
            }
          }
          return undefined;
        },
      },
    ],
    // Inject the analytics <script> verbatim into <head>, but only when
    // ANALYTICS_SCRIPT is provided (production CI build).
    ...(analyticsScript
      ? [
          function analyticsPlugin() {
            return {
              name: 'analytics-script',
              injectHtmlTags() {
                return {headTags: analyticsScript};
              },
            };
          },
        ]
      : []),
  ],

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/',
        highlightSearchTermsOnTargetPage: true,
        searchResultLimits: 8,
      },
    ],
  ],

  themeConfig: {
    image: 'assets/img/screenshot.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      // The logo SVG already includes the "AliasVault" wordmark, so no
      // separate title text (which would render the name twice). Light mode
      // uses the dark-wordmark logo; dark mode the white one.
      logo: {
        alt: 'AliasVault',
        src: 'assets/img/logo-light.svg',
        srcDark: 'assets/img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'installSidebar',
          position: 'left',
          label: 'Self-host Install',
        },
        {
          type: 'doc',
          docId: 'architecture',
          position: 'left',
          label: 'Architecture',
        },
        {
          type: 'docSidebar',
          sidebarId: 'contributingSidebar',
          position: 'left',
          label: 'Contributing',
        },
        {
          type: 'doc',
          docId: 'contact',
          position: 'left',
          label: 'Contact',
        },
        {
          href: 'https://www.aliasvault.com',
          label: 'Website',
          position: 'right',
          className: 'navbar__icon-link navbar__icon-link--website',
          'aria-label': 'AliasVault website',
        },
        {
          href: 'https://discord.gg/DsaXMTEtpF',
          label: 'Discord',
          position: 'right',
          className: 'navbar__icon-link navbar__icon-link--discord',
          'aria-label': 'AliasVault Discord',
        },
        {
          href: 'https://github.com/aliasvault/aliasvault',
          label: 'GitHub',
          position: 'right',
          className: 'navbar__icon-link navbar__icon-link--github',
          'aria-label': 'AliasVault GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Self-host Install', to: '/installation/'},
            {label: 'Browser Extensions', to: '/installation/browser-extensions/'},
            {label: 'Mobile Apps', to: '/installation/mobile-apps/'},
            {label: 'Architecture', to: '/architecture/'},
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/aliasvault/aliasvault',
            },
            {label: 'Contributing', to: '/contributing/'},
            {label: 'Contact', to: '/contact/'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'Website', href: 'https://www.aliasvault.com'},
            {
              label: 'Edit these docs',
              href: 'https://github.com/aliasvault/aliasvault/tree/main/docs',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AliasVault.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'docker', 'nginx', 'csharp'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
