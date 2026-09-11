/**
 * Registers the extension platform with the client core.
 */

import { setPlatform } from '@aliasvault/client/platform';

import { extensionPlatform } from '@/platform/ExtensionPlatform';

setPlatform(extensionPlatform);
