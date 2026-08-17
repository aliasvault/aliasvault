/**
 * The email-routing set sent on a vault push: one entry per (address, manifest) pair. An address claimed by
 * several manifests (personal + shared during family sharing) appears once per manifest; the server links the
 * claim to each so incoming mail is key-wrapped per linked manifest.
 */
export type EmailRoutingPush = {
  emailAddressList: Array<{ address: string; manifestId: string; paused: boolean }>;
  /**
   * The manifests this push speaks for: every manifest that went into the address list above, including the ones
   * that hold no alias.
   */
  coveredManifestIds: string[];
};
