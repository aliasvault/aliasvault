/**
 * What the autofill confirmation window shows about a fill it asks the user to approve.
 */
export type AutofillConfirmation = {
  itemName: string;
  itemDetails: string;
  itemUrls: string[];
  logoSrc?: string;
  pageHost: string;
  matchesPage: boolean;
};

/**
 * The user's answer in the confirmation window: fill and add the page URL to the item, only fill, or cancel.
 */
export type AutofillConfirmAnswer = 'link' | 'fill' | 'cancel';
