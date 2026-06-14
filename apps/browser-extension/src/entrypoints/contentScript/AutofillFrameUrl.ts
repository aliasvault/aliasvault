export type AutofillFrameLocation = Pick<Location, 'protocol' | 'hostname' | 'href'>;

/**
 * Return the current frame URL only when it represents a real web origin.
 * AliasVault must not title-match credentials inside about/srcdoc/blob frames.
 */
export function getCurrentAutofillFrameUrl(currentLocation: AutofillFrameLocation = window.location): string | null {
  if (
    (currentLocation.protocol !== 'https:' && currentLocation.protocol !== 'http:') ||
    !currentLocation.hostname
  ) {
    return null;
  }

  return currentLocation.href;
}
