import { Gender } from './Gender';

/**
 * Identity.
 */
export type Identity = {
    firstName: string;
    lastName: string;
    gender: Gender;
    birthDate: Date;
    emailPrefix: string;
    nickName: string;
  }