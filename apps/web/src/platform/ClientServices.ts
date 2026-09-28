/**
 * Registers the web platform with the client core.
 */

import { setPlatform } from '@aliasvault/client/platform';

import { webPlatform } from '@/platform/WebPlatform';

setPlatform(webPlatform);
