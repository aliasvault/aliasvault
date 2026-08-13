/**
 * The email-routing set sent on a vault push: one entry per (address, manifest) pair. An address claimed by
 * several manifests (personal + shared during family sharing) appears once per manifest; the server links the
 * claim to each so incoming mail is key-wrapped per linked manifest.
 *
 * Every alias the vault carries is pushed. Absence from the list means the alias is gone from the vault
 * (the server disables its claim, which starts the retention clock on its stored mail), while `paused: true`
 * in this list means the user only stopped its mail (the claim link survives and its stored mail stays readable).
 *
 * This is the v2 push shape. The frozen v1 push sends a plain address list with no per-alias state.
 */
export type EmailRoutingPush = {
  emailAddressList: Array<{ address: string; manifestId: string; paused: boolean }>;
};
