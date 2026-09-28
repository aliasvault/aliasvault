import { useEffect } from 'react';

/**
 * Set the document title in the "{title} - AliasVault" form.
 * @param title - the page title
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} - AliasVault`;
  }, [title]);
}
