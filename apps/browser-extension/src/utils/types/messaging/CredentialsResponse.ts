import type { Credential } from "@/utils/dist/core/models/vault";

export type CredentialsResponse = {
    success: boolean,
    error?: string,
    credentials?: Credential[]
};
