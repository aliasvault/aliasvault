/**
 * CIDv1 validation utility.
 * Per project-context.md Rule 2: ALL IPFS CIDs MUST be CIDv1 format.
 * Canonical location — imported by both CLI API and contract tests.
 */

/**
 * Asserts that a CID string is CIDv1 format (base32-encoded).
 * Rejects CIDv0 (starts with "Qm") and non-base32 encoded CIDs.
 * Note: This is a basic format check suitable for MVP. Does not validate
 * multibase prefix, CID structure, or digest (see L1 in code review).
 */
export const assertCIDv1 = (cid: string): void => {
  if (cid.startsWith('Qm')) {
    throw new Error('CIDv0 detected. Convert to CIDv1 using IPFS CID.parse().');
  }
  if (!/^[a-z2-7]/.test(cid)) {
    throw new Error('CID must be base32 encoded (CIDv1).');
  }
};
