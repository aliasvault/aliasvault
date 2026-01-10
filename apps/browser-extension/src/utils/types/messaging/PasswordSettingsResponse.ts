import type { PasswordSettings } from "@/utils/dist/core/models/vault";

export type PasswordSettingsResponse = {
    success: boolean,
    error?: string,
    settings?: PasswordSettings
};
