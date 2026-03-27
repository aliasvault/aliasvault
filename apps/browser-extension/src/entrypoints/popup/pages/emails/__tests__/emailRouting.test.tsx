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
  mockGetCachedEmails,
  mockStorageGet,
  mockStorageSet,
  mockStorageRemove,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockGetSetting: vi.fn().mockReturnValue(null),
  mockGetCachedEmails: vi.fn().mockResolvedValue([]),
  mockStorageGet: vi.fn().mockResolvedValue({}),
  mockStorageSet: vi.fn().mockResolvedValue(undefined),
  mockStorageRemove: vi.fn().mockResolvedValue(undefined),
}));

// Stub chrome global before any imports
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockStorageGet,
      set: mockStorageSet,
      remove: mockStorageRemove,
    },
  },
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/entrypoints/popup/context/DbContext', () => ({
  useDb: () => ({
    vaultStore: {
      getSetting: mockGetSetting,
    },
  }),
}));

describe('Email routing — unified blockchain path', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue(null);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('BottomNav emails tab navigates to /inbox', async () => {
    const { default: BottomNav } = await import(
      '@/entrypoints/popup/components/Layout/BottomNav'
    );

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/credentials']}>
          <BottomNav />
        </MemoryRouter>,
      );
    });

    // Find the emails tab button by its translated key
    const buttons = container.querySelectorAll('button');
    const emailsButton = Array.from(buttons).find((btn) =>
      btn.textContent?.includes('menu.emails'),
    );

    expect(emailsButton).toBeDefined();

    await act(async () => {
      emailsButton!.click();
    });

    // Should navigate to /inbox (blockchain route), not /emails (legacy)
    expect(mockNavigate).toHaveBeenCalledWith('/inbox');
  });

  it('BottomNav does NOT render a separate inbox tab', async () => {
    // Enable email feature
    mockGetSetting.mockImplementation((key: string) =>
      key === 'emailPublicKey' ? '0xabc' : null,
    );

    const { default: BottomNav } = await import(
      '@/entrypoints/popup/components/Layout/BottomNav'
    );

    await act(async () => {
      createRoot(container).render(
        <MemoryRouter initialEntries={['/credentials']}>
          <BottomNav />
        </MemoryRouter>,
      );
    });

    const buttons = container.querySelectorAll('button');
    const labels = Array.from(buttons).map((b) => b.textContent?.trim());

    // Should NOT have a separate "Inbox" tab alongside "Emails"
    expect(labels.filter((l) => l === 'Inbox')).toHaveLength(0);
    expect(labels.filter((l) => l?.includes('menu.inbox'))).toHaveLength(0);
  });
});
