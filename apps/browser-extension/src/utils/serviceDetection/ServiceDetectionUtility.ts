import { FormDetector } from '../formDetector/FormDetector';

/**
 * Utility for detecting service name and URL information
 * Shared between content script and popup dashboard
 */
export class ServiceDetectionUtility {
  /**
   * Sanitize a raw URL down to its origin (scheme + host + port), stripping the
   * path, query string and fragment.
   */
  public static sanitizeUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      // Only include http/https URLs
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return '';
      }
      return url.origin;
    } catch (error) {
      console.error('Error parsing URL:', error);
      return '';
    }
  }

  /**
   * Get service information from the current page
   */
  public static getServiceInfo(document: Document, location: Location): ServiceInfo {
    // Get suggested service names using FormDetector
    const suggestedNames = FormDetector.getSuggestedServiceName(document, location);

    // Get the current URL
    const currentUrl = location.href;

    // Process the URL to extract service URL (origin only)
    const serviceUrl = this.sanitizeUrl(currentUrl);

    return {
      suggestedNames,
      currentUrl,
      serviceUrl,
      domain: location.hostname.replace(/^www\./, '')
    };
  }

  /**
   * Get service information from tab data (for use in popup dashboard)
   */
  public static getServiceInfoFromTab(tabUrl: string, tabTitle?: string): ServiceInfo {
    try {
      const url = new URL(tabUrl);
      const location = {
        href: tabUrl,
        hostname: url.hostname,
        protocol: url.protocol,
        pathname: url.pathname,
        origin: url.origin
      } as Location;

      // Create a minimal document object for service name detection
      const mockDocument = {
        title: tabTitle || url.hostname
      } as Document;

      // Use FormDetector logic for service name detection
      const suggestedNames = FormDetector.getSuggestedServiceName(mockDocument, location);

      // Get service URL (origin only)
      const serviceUrl = this.sanitizeUrl(tabUrl);

      return {
        suggestedNames,
        currentUrl: tabUrl,
        serviceUrl,
        domain: url.hostname.replace(/^www\./, '')
      };
    } catch (error) {
      console.error('Error parsing tab URL:', error);
      // Fallback to basic hostname detection
      const domain = tabUrl.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      return {
        suggestedNames: [domain],
        currentUrl: tabUrl,
        serviceUrl: tabUrl,
        domain
      };
    }
  }

  /**
   * Get encoded service information suitable for URL parameters
   */
  public static getEncodedServiceInfo(document: Document, location: Location): EncodedServiceInfo {
    const serviceInfo = this.getServiceInfo(document, location);

    return {
      serviceName: serviceInfo.suggestedNames.length > 0 ? encodeURIComponent(serviceInfo.suggestedNames[0]) : '',
      serviceUrl: serviceInfo.serviceUrl ? encodeURIComponent(serviceInfo.serviceUrl) : '',
      currentUrl: encodeURIComponent(serviceInfo.currentUrl),
      domain: encodeURIComponent(serviceInfo.domain)
    };
  }

  /**
   * Get encoded service information from tab data
   */
  public static getEncodedServiceInfoFromTab(tabUrl: string, tabTitle?: string): EncodedServiceInfo {
    const serviceInfo = this.getServiceInfoFromTab(tabUrl, tabTitle);

    return {
      serviceName: serviceInfo.suggestedNames.length > 0 ? encodeURIComponent(serviceInfo.suggestedNames[0]) : '',
      serviceUrl: serviceInfo.serviceUrl ? encodeURIComponent(serviceInfo.serviceUrl) : '',
      currentUrl: encodeURIComponent(serviceInfo.currentUrl),
      domain: encodeURIComponent(serviceInfo.domain)
    };
  }
}

/**
 * Service information interface
 */
export type ServiceInfo = {
  /** Array of suggested service names */
  suggestedNames: string[];
  /** Current page URL */
  currentUrl: string;
  /** Service URL (origin only: scheme + host + port) */
  serviceUrl: string;
  /** Domain name without www prefix */
  domain: string;
}

/**
 * Encoded service information interface
 */
export type EncodedServiceInfo = {
  /** URL-encoded primary service name */
  serviceName: string;
  /** URL-encoded service URL */
  serviceUrl: string;
  /** URL-encoded current page URL */
  currentUrl: string;
  /** URL-encoded domain */
  domain: string;
}
