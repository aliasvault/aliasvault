import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ServiceDetectionUtility, type ServiceInfo } from '@/utils/serviceDetection/ServiceDetectionUtility';

import { browser } from '#imports';

/**
 * Result of service detection containing name and URL.
 */
type ServiceDetectionResult = {
  /** Detected service name (e.g., "GitHub", "Google") */
  serviceName: string;
  /** Detected service URL (origin only: scheme + host + port) */
  serviceUrl: string;
  /** Alternative service name suggestions derived from the page title/domain */
  suggestedNames: string[];
};

/**
 * Hook for detecting service information from URL parameters or the active browser tab.
 *
 * Service detection sources (in priority order):
 * 1. URL parameters (serviceUrl, currentUrl) + the provided title - e.g., from the content script create flow
 * 2. Active browser tab - for dashboard/popup opened directly
 */
const useServiceDetection = (): {
  detectService: (fallbackName?: string | null) => Promise<ServiceDetectionResult>;
} => {
  const [searchParams] = useSearchParams();

  /**
   * Detect service information from URL parameters or active tab.
   *
   * @param fallbackName - Optional fallback name if detection fails (e.g., from URL param)
   * @returns Promise resolving to detected service name and URL
   */
  const detectService = useCallback(async (fallbackName?: string | null): Promise<ServiceDetectionResult> => {
    let detectedName = fallbackName || '';
    let detectedUrl = '';
    let suggestedNames: string[] = [];

    try {
      // Get URL parameters (e.g., from content script create flow)
      const serviceUrlFromUrl = searchParams.get('serviceUrl');
      const currentUrl = searchParams.get('currentUrl');

      // If URL parameters are present, use them
      if (serviceUrlFromUrl || currentUrl) {
        if (serviceUrlFromUrl) {
          detectedUrl = decodeURIComponent(serviceUrlFromUrl);
        }

        // If we have currentUrl, derive url/suggestions from it (and a name only as a fallback)
        if (currentUrl) {
          const decodedCurrentUrl = decodeURIComponent(currentUrl);
          const serviceInfo: ServiceInfo = ServiceDetectionUtility.getServiceInfoFromTab(decodedCurrentUrl);
          suggestedNames = serviceInfo.suggestedNames;

          // Only fall back to a URL-derived name when no explicit title was provided.
          if (!detectedName && serviceInfo.suggestedNames.length > 0) {
            detectedName = serviceInfo.suggestedNames[0];
          }
          if (!serviceUrlFromUrl && serviceInfo.serviceUrl) {
            detectedUrl = serviceInfo.serviceUrl;
          }
        }
      } else {
        // No URL parameters - detect from current active tab (dashboard case)
        const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });

        if (activeTab?.url) {
          const serviceInfo: ServiceInfo = ServiceDetectionUtility.getServiceInfoFromTab(
            activeTab.url,
            activeTab.title
          );
          suggestedNames = serviceInfo.suggestedNames;

          if (serviceInfo.suggestedNames.length > 0 && !detectedName) {
            detectedName = serviceInfo.suggestedNames[0];
          }
          if (serviceInfo.serviceUrl) {
            detectedUrl = serviceInfo.serviceUrl;
          }
        }
      }
    } catch (error) {
      console.error('Error detecting service information:', error);
    }

    return {
      serviceName: detectedName,
      serviceUrl: detectedUrl,
      suggestedNames,
    };
  }, [searchParams]);

  return {
    detectService,
  };
};

export default useServiceDetection;
export type { ServiceDetectionResult };
