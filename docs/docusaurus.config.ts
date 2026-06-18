import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AliasVault',
  tagline: 'A privacy-first password manager with built-in email aliasing',
  favicon: 'assets/img/favicon.png',

  url: 'https://docs.aliasvault.net',
  baseUrl: '/',

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
          editUrl: 'https://github.com/aliasvault/aliasvault/tree/main/docs/docs/',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
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
        ],
      },
    ],
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
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://aliasvault.net',
          label: 'Website',
          position: 'right',
        },
        {
          href: 'https://github.com/aliasvault/aliasvault',
          label: 'GitHub',
          position: 'right',
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
            {label: 'Browser Extensions', to: '/browser-extensions/'},
            {label: 'Mobile Apps', to: '/mobile-apps/'},
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
            {label: 'Help & Support', to: '/contact/'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'Website', href: 'https://aliasvault.net'},
            {
              label: 'Edit these docs',
              href: 'https://github.com/aliasvault/aliasvault/tree/main/docs',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AliasVault. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'docker', 'nginx', 'csharp'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
