/**
 * The email-routing set sent on a vault push: every alias the server should route, each carrying the manifest
 * that owns it.
 */
export type EmailRoutingPush = {
  emailAddressList: Array<{ address: string; manifestId: string }>;
};
