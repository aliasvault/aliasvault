import type { Gender } from './Gender';

/**
 * A generated identity as returned by the Rust core identity generator
 */
export type Identity = {
  firstName: string;
  lastName: string;
  gender: Gender | string;
  /** Birth date in yyyy-MM-dd format. */
  birthDate: string;
  emailPrefix: string;
  /** Username derived from the name and birth year (alphanumeric only). */
  nickName: string;
};
