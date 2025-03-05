import { Gender } from "../generators/Identity/types/Gender";

/**
 * Credential SQLite database type.
 */
export type Credential = {
    Id: string;
    Username: string;
    Password: string;
    Email: string;
    ServiceName: string;
    ServiceUrl?: string;
    Logo?: Uint8Array | number[];
    Notes?: string;
    Alias: {
        FirstName: string;
        LastName: string;
        NickName?: string;
        BirthDate: string;
        Gender?: Gender;
        Email?: string;
    };
}