/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

// ── Hoisted mocks ──
const {
  mockNavigate,
  mockGetSetting,
  mockSetHeaderButtons,
  mockSetIsInitialLoading,
  mockGetCachedFullBody,
  mockCacheFullBody,
  mockMarkAsRead,
  mockDeleteEmail,
  mockDecryptEmailBlob,
  mockAssertInboxCIDv1,
  mockPinataDownload,
  mockGetEmailKeyPairFromSettings,
  mockStorageGet,
  mockStorageSet,
  mockStorageRemove,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetSetting: vi.fn().mockReturnValue(null),
  mockSetHeaderButtons: vi.fn(),
  mockSetIsInitialLoading: vi.fn(),
  mockGetCachedFullBody: vi.fn().mockResolvedValue(null),
  mockCacheFullBody: vi.fn().mockResolvedValue(undefined),
  mockMarkAsRead: vi.fn().mockResolvedValue(undefined),
  mockDeleteEmail: vi.fn().mockResolvedValue(undefined),
  mockDecryptEmailBlob: vi.fn(),
  mockAssertInboxCIDv1: vi.fn(),
  mockPinataDownload: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockGetEmailKeyPairFromSettings: vi.fn(),
  mockStorageGet: vi.fn().mockResolvedValue({}),
  mockStorageSet: vi.fn().mockResolvedValue(undefined),
  mockStorageRemove: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal('chrome', {
  storage: { local: { get: mockStorageGet, set: mockStorageSet, remove: mockStorageRemove } },
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ cid: 'bafyreiabc123test1' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback || key }),
}));

vi.mock('@/entrypoints/popup/context/DbContext', () => ({
  useDb: () => ({
    vaultStore: { getSetting: mockGetSetting },
  }),
}));

vi.mock('@/entrypoints/popup/context/HeaderButtonsContext', () => ({
  useHeaderButtons: () => ({ setHeaderButtons: mockSetHeaderButtons }),
}));

vi.mock('@/entrypoints/popup/context/LoadingContext', () => ({
  useLoading: () => ({ setIsInitialLoading: mockSetIsInitialLoading }),
}));

vi.mock('@/entrypoints/popup/utils/PopoutUtility', () => ({
  PopoutUtility: { isPopup: () => false, openInNewPopup: vi.fn() },
}));

const { mockSetIsLoading } = vi.hoisted(() => ({
  mockSetIsLoading: vi.fn(),
}));

vi.mock('@/hooks/useMinDurationLoading', () => ({
  useMinDurationLoading: () => [false, mockSetIsLoading] as const,
}));

vi.mock('@/services/EmailDecryptionService', () => ({
  decryptEmailBlob: (...args: unknown[]) => mockDecryptEmailBlob(...args),
  DecryptedEmail: {},
}));

vi.mock('@/services/EmailCacheService', () => ({
  emailCacheService: {
    getCachedFullBody: (...args: unknown[]) => mockGetCachedFullBody(...args),
    cacheFullBody: (...args: unknown[]) => mockCacheFullBody(...args),
    markAsRead: (...args: unknown[]) => mockMarkAsRead(...args),
    deleteEmail: (...args: unknown[]) => mockDeleteEmail(...args),
  },
  EmailCacheService: class {},
}));

vi.mock('@/services/InboxService', () => ({
  assertInboxCIDv1: (...args: unknown[]) => mockAssertInboxCIDv1(...args),
}));

vi.mock('@/services/PinataBrowserProvider', () => ({
  PinataBrowserProvider: class {
    download = mockPinataDownload;
  },
}));

vi.mock('@/utils/emailKeyPair', () => ({
  getEmailKeyPairFromSettings: (...args: unknown[]) => mockGetEmailKeyPairFromSettings(...args),
}));

vi.mock('@/entrypoints/popup/components/Dialogs/Modal', () => ({
  default: () => null,
}));

vi.mock('@/entrypoints/popup/components/HeaderButton', () => ({
  default: () => null,
}));

vi.mock('@/entrypoints/popup/components/Icons/HeaderIcons', () => ({
  HeaderIconType: { EXPAND: 'expand', DELETE: 'delete' },
}));

vi.mock('@/entrypoints/popup/components/LoadingSpinner', () => ({
  default: () => null,
}));

const SAMPLE_EMAIL = {
  from: 'John Doe <john@example.com>',
  to: 'alias@alias.id',
  subject: 'Test Subject',
  body: 'Hello world',
  attachments: [{ name: 'file.txt', contentType: 'text/plain', base64: 'aGVsbG8=' }],
  receivedAt: 1709553600,
};

describe('InboxDetail', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);

    // Default: email keys configured
    mockGetSetting.mockImplementation((key: string) => {
      const map: Record<string, string> = {
        emailPublicKey: 'aabb',
        emailPrivateKey: 'ccdd',
        pinataJwt: 'jwt-token',
        pinataGateway: 'https://gateway.example',
      };
      return map[key] ?? null;
    });

    mockGetEmailKeyPairFromSettings.mockReturnValue({
      publicKey: new Uint8Array(32),
      secretKey: new Uint8Array(32),
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('uses cached body when available (cache hit — no IPFS fetch)', async () => {
    mockGetCachedFullBody.mockResolvedValue(SAMPLE_EMAIL);

    const { default: InboxDetail } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/inbox/bafyreiabc123test1']}>
          <InboxDetail />
        </MemoryRouter>,
      );
    });

    // Wait for async load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should have checked cache
    expect(mockGetCachedFullBody).toHaveBeenCalledWith('bafyreiabc123test1');
    // Should NOT have fetched from IPFS
    expect(mockPinataDownload).not.toHaveBeenCalled();
    expect(mockDecryptEmailBlob).not.toHaveBeenCalled();
    // Should have marked as read
    expect(mockMarkAsRead).toHaveBeenCalledWith('bafyreiabc123test1');
    // Should NOT cache again (already cached)
    expect(mockCacheFullBody).not.toHaveBeenCalled();
  });

  it('fetches from IPFS on cache miss and caches the result', async () => {
    mockGetCachedFullBody.mockResolvedValue(null);
    mockDecryptEmailBlob.mockReturnValue(SAMPLE_EMAIL);

    const { default: InboxDetail } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/inbox/bafyreiabc123test1']}>
          <InboxDetail />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should have checked cache first
    expect(mockGetCachedFullBody).toHaveBeenCalledWith('bafyreiabc123test1');
    // Cache miss → IPFS fetch
    expect(mockPinataDownload).toHaveBeenCalledWith('bafyreiabc123test1');
    expect(mockDecryptEmailBlob).toHaveBeenCalled();
    // Should cache the decrypted result
    expect(mockCacheFullBody).toHaveBeenCalledWith('bafyreiabc123test1', SAMPLE_EMAIL);
    // Should mark as read
    expect(mockMarkAsRead).toHaveBeenCalledWith('bafyreiabc123test1');
  });

  it('renders subject and parsed sender after load', async () => {
    mockGetCachedFullBody.mockResolvedValue(SAMPLE_EMAIL);

    const { default: InboxDetail } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/inbox/bafyreiabc123test1']}>
          <InboxDetail />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Subject should render
    expect(container.textContent).toContain('Test Subject');
    // Body should render
    expect(container.textContent).toContain('Hello world');
  });
});

describe('parseSender', () => {
  it('parses "Name <email>" format', async () => {
    const { parseSender } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );
    const result = parseSender('John Doe <john@example.com>');
    expect(result).toEqual({ display: 'John Doe', address: 'john@example.com' });
  });

  it('handles plain email address', async () => {
    const { parseSender } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );
    const result = parseSender('john@example.com');
    expect(result).toEqual({ display: 'john@example.com', address: 'john@example.com' });
  });

  it('trims whitespace from display name', async () => {
    const { parseSender } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );
    const result = parseSender('  Jane Smith   <jane@test.org>');
    expect(result).toEqual({ display: 'Jane Smith', address: 'jane@test.org' });
  });

  it('handles empty string gracefully', async () => {
    const { parseSender } = await import(
      '@/entrypoints/popup/pages/emails/InboxDetail'
    );
    const result = parseSender('');
    expect(result).toEqual({ display: '', address: '' });
  });
});
