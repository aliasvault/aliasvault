import type { PasswordSettings } from "@aliasvault/models/vault";

export type PasswordSettingsResponse = {
    success: boolean,
    error?: string,
    settings?: PasswordSettings
};
