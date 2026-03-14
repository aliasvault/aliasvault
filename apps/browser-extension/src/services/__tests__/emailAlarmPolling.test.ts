import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome APIs
const storageData: Record<string, unknown> = {};
const mockAlarmCreate = vi.fn();
const mockAlarmClear = vi.fn();
const alarmListeners: Array<(alarm: { name: string }) => void> = [];
const mockSetBadgeText = vi.fn();
const mockSetBadgeBackgroundColor = vi.fn();

vi.stubGlobal('chrome', {
  alarms: {
    create: mockAlarmCreate,
    clear: mockAlarmClear,
    onAlarm: {
      addListener: vi.fn((fn) => alarmListeners.push(fn)),
    },
  },
  action: {
    setBadgeText: mockSetBadgeText,
    setBadgeBackgroundColor: mockSetBadgeBackgroundColor,
  },
  storage: {
    local: {
      get: vi.fn((keys: string | string[]) => {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const key of keyList) {
          if (key in storageData) result[key] = storageData[key];
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(storageData, items);
        return Promise.resolve();
      }),
    },
  },
});

import {
  registerEmailAlarm,
  unregisterEmailAlarm,
  handleEmailAlarm,
  clearEmailBadge,
  setupEmailAlarmListener,
} from '@/entrypoints/background/EmailAlarmHandler';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(storageData)) delete storageData[key];
  alarmListeners.length = 0;
});

describe('registerEmailAlarm', () => {
  it('creates a periodic alarm', async () => {
    await registerEmailAlarm();

    expect(mockAlarmCreate).toHaveBeenCalledWith('check-email', {
      periodInMinutes: 3,
    });
  });
});

describe('unregisterEmailAlarm', () => {
  it('clears the email alarm', async () => {
    await unregisterEmailAlarm();

    expect(mockAlarmClear).toHaveBeenCalledWith('check-email');
  });
});

describe('handleEmailAlarm', () => {
  it('sets badge when email count increases', async () => {
    storageData['lastKnownEmailCount'] = 2;
    const readEmailCount = vi.fn().mockResolvedValue(5);

    await handleEmailAlarm(readEmailCount);

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '3' });
    expect(mockSetBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#ef4444' });
    expect(storageData['lastKnownEmailCount']).toBe(5);
  });

  it('does not set badge when count unchanged', async () => {
    storageData['lastKnownEmailCount'] = 5;
    const readEmailCount = vi.fn().mockResolvedValue(5);

    await handleEmailAlarm(readEmailCount);

    expect(mockSetBadgeText).not.toHaveBeenCalled();
  });

  it('handles first-time check (no stored count)', async () => {
    const readEmailCount = vi.fn().mockResolvedValue(3);

    await handleEmailAlarm(readEmailCount);

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '3' });
    expect(storageData['lastKnownEmailCount']).toBe(3);
  });

  it('does not set badge when count is 0', async () => {
    const readEmailCount = vi.fn().mockResolvedValue(0);

    await handleEmailAlarm(readEmailCount);

    expect(mockSetBadgeText).not.toHaveBeenCalled();
  });
});

describe('clearEmailBadge', () => {
  it('clears badge text', async () => {
    await clearEmailBadge();

    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});

describe('setupEmailAlarmListener', () => {
  it('registers alarm listener', () => {
    const readEmailCount = vi.fn().mockResolvedValue(0);
    setupEmailAlarmListener(readEmailCount);

    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
  });

  it('only triggers on check-email alarm name', async () => {
    const readEmailCount = vi.fn().mockResolvedValue(3);
    setupEmailAlarmListener(readEmailCount);

    // Simulate different alarm
    const listener = alarmListeners[0];
    await listener({ name: 'some-other-alarm' });

    expect(readEmailCount).not.toHaveBeenCalled();
  });

  it('triggers readEmailCount on check-email alarm', async () => {
    storageData['lastKnownEmailCount'] = 0;
    const readEmailCount = vi.fn().mockResolvedValue(2);
    setupEmailAlarmListener(readEmailCount);

    const listener = alarmListeners[0];
    await listener({ name: 'check-email' });

    expect(readEmailCount).toHaveBeenCalled();
    expect(mockSetBadgeText).toHaveBeenCalledWith({ text: '2' });
  });
});
