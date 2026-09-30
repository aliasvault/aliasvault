/**
 * A downloadable client app (browser extension or mobile app).
 */
export type AppInfo = {
  name: string;
  iconPath: string;
  downloadUrl: string;
  isAvailable: boolean;
};

/** The browser extensions. */
export const BROWSER_EXTENSIONS: AppInfo[] = [
  { name: 'Google Chrome', iconPath: '/img/browser-icons/chrome.svg', downloadUrl: 'https://chromewebstore.google.com/detail/aliasvault/bmoggiinmnodjphdjnmpcnlleamkfedj', isAvailable: true },
  { name: 'Firefox', iconPath: '/img/browser-icons/firefox.svg', downloadUrl: 'https://addons.mozilla.org/en-US/firefox/addon/aliasvault/', isAvailable: true },
  { name: 'Safari', iconPath: '/img/browser-icons/safari.svg', downloadUrl: 'https://apps.apple.com/app/6743163173', isAvailable: true },
  { name: 'Microsoft Edge', iconPath: '/img/browser-icons/edge.svg', downloadUrl: 'https://microsoftedge.microsoft.com/addons/detail/aliasvault/kabaanafahnjkfkplbnllebdmppdemfo', isAvailable: true },
  { name: 'Brave', iconPath: '/img/browser-icons/brave.svg', downloadUrl: 'https://chromewebstore.google.com/detail/aliasvault/bmoggiinmnodjphdjnmpcnlleamkfedj', isAvailable: true },
];

/** The mobile apps. */
export const MOBILE_APPS: AppInfo[] = [
  { name: 'iOS', iconPath: '/img/mobile-icons/ios.svg', downloadUrl: 'https://apps.apple.com/app/id6745490915', isAvailable: true },
  { name: 'Android', iconPath: '/img/mobile-icons/android.svg', downloadUrl: 'https://play.google.com/store/apps/details?id=net.aliasvault.app', isAvailable: true },
];
