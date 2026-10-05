/**
 * Response of POST /v2/Identity/CheckEmail/{email}.
 */
export type CheckEmailResponse = {
  /**
   * Whether the address is already taken.
   */
  isTaken: boolean;
}
