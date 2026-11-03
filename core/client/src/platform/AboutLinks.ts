import { AppInfo } from './AppInfo';

/**
 * An external link shown on the About screen.
 */
export type AboutLink = {
  id: 'contactSupport' | 'website' | 'documentation' | 'sourceCode' | 'privacyPolicy' | 'reportIssue';
  labelKey: string;
  url: string;
  officialServerOnly?: boolean;
};

/**
 * The external links shown on the About screen of every client: one section per group, in display order.
 */
const ABOUT_LINK_GROUPS: readonly (readonly AboutLink[])[] = [
  [
    { id: 'contactSupport', labelKey: 'settings.about.contactSupport', url: 'https://www.aliasvault.com/contact', officialServerOnly: true },
    { id: 'website', labelKey: 'settings.about.website', url: 'https://www.aliasvault.com' },
    { id: 'documentation', labelKey: 'settings.about.documentation', url: 'https://docs.aliasvault.com' },
    { id: 'privacyPolicy', labelKey: 'settings.about.privacyPolicy', url: 'https://www.aliasvault.com/privacy-policy' },
  ],
  [
    { id: 'sourceCode', labelKey: 'settings.about.sourceCode', url: 'https://github.com/aliasvault/aliasvault' },
    { id: 'reportIssue', labelKey: 'settings.about.reportIssue', url: 'https://github.com/aliasvault/aliasvault/issues' },
  ],
];

/**
 * The About screen link sections for the given API URL; support is only offered on the official server.
 */
export function getAboutLinkGroups(apiUrl: string): AboutLink[][] {
  const isOfficialServer = apiUrl === AppInfo.DEFAULT_API_URL;
  return ABOUT_LINK_GROUPS.map((group) => group.filter((link) => !link.officialServerOnly || isOfficialServer));
}
