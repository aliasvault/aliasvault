import { useCallback, useEffect, useRef } from 'react';
import { sendMessage } from 'webext-bridge/popup';

/**
 * Generic form persistence hook for saving and restoring form state.
 *
 * Persists form data to the background script (encrypted storage) and automatically:
 * - Saves state whenever dependencies change
 * - Clears persisted state when the component unmounts
 *
 * The form data type is generic, allowing this hook to be reused across different forms.
 *
 * @template T - The type of form data to persist
 */
type UseFormPersistenceOptions<T> = {
  /**
   * Unique identifier for the form instance (e.g., item ID or null for new items).
   * Used to verify we're restoring data for the correct form.
   */
  formId: string | null;

  /**
   * Whether the form is still loading initial data.
   * Persistence is disabled while loading to avoid overwriting restored state.
   */
  isLoading: boolean;

  /**
   * The current form data to persist.
   */
  formData: T;

  /**
   * Callback to restore form data when loaded from storage.
   */
  onRestore: (data: T) => void;

  /**
   * Whether to skip restoration on mount (e.g., when opening from popout button).
   * If true, loadPersistedValues() returns false immediately without loading.
   */
  skipRestore?: boolean;
};

type UseFormPersistenceReturn = {
  /**
   * Manually load persisted values from storage.
   * Returns true if data was restored, false otherwise.
   */
  loadPersistedValues: () => Promise<boolean>;

  /**
   * Manually clear persisted values from storage.
   */
  clearPersistedValues: () => Promise<void>;

  /**
   * Manually persist current values to storage.
   * Usually not needed as auto-persistence handles this.
   */
  persistFormValues: () => Promise<void>;
};

/**
 * Persisted data wrapper that includes form ID for validation.
 */
type PersistedDataWrapper<T> = {
  formId: string | null;
  data: T;
};

/**
 * Hook for persisting form state to encrypted background storage.
 *
 * @example
 * ```tsx
 * const { loadPersistedValues, clearPersistedValues } = useFormPersistence({
 *   formId: id || null,
 *   isLoading: localLoading,
 *   formData: { item, fieldValues, customFields },
 *   onRestore: (data) => {
 *     setItem(data.item);
 *     setFieldValues(data.fieldValues);
 *     setCustomFields(data.customFields);
 *   },
 * });
 * ```
 */
const useFormPersistence = <T>({
  formId,
  isLoading,
  formData,
  onRestore,
  skipRestore = false,
}: UseFormPersistenceOptions<T>): UseFormPersistenceReturn => {
  // Track if we've already restored to avoid duplicate restores
  const hasRestored = useRef(false);

  /**
   * Persist the current form values to encrypted storage.
   */
  const persistFormValues = useCallback(async (): Promise<void> => {
    if (isLoading) {
      // Do not persist values if the form is still loading
      return;
    }

    const persistedData: PersistedDataWrapper<T> = {
      formId,
      data: formData,
    };

    await sendMessage('PERSIST_FORM_VALUES', JSON.stringify(persistedData), 'background');
  }, [formId, formData, isLoading]);

  /**
   * Load persisted form values from storage.
   * Returns true if data was successfully restored, false otherwise.
   */
  const loadPersistedValues = useCallback(async (): Promise<boolean> => {
    if (skipRestore) {
      return false;
    }

    if (hasRestored.current) {
      return false;
    }

    const persistedData = await sendMessage('GET_PERSISTED_FORM_VALUES', null, 'background') as string | null;

    try {
      if (!persistedData) {
        return false;
      }

      let wrapper: PersistedDataWrapper<T> | null = null;
      try {
        wrapper = JSON.parse(persistedData) as PersistedDataWrapper<T>;
      } catch (error) {
        console.error('Error parsing persisted form data:', error);
        return false;
      }

      // Verify this is data for the current form
      const isCurrentForm = wrapper.formId === formId;
      if (!isCurrentForm) {
        return false;
      }

      hasRestored.current = true;
      onRestore(wrapper.data);
      return true;
    } catch (error) {
      console.error('Error loading persisted form data:', error);
      return false;
    }
  }, [formId, onRestore, skipRestore]);

  /**
   * Clear persisted form values from storage.
   */
  const clearPersistedValues = useCallback(async (): Promise<void> => {
    await sendMessage('CLEAR_PERSISTED_FORM_VALUES', null, 'background');
  }, []);

  /**
   * Auto-persist when form data changes (after initial load).
   */
  useEffect(() => {
    if (!isLoading) {
      void persistFormValues();
    }
  }, [isLoading, persistFormValues]);

  /**
   * Clear persisted values when component unmounts.
   */
  useEffect(() => {
    return (): void => {
      void clearPersistedValues();
    };
  }, [clearPersistedValues]);

  return {
    loadPersistedValues,
    clearPersistedValues,
    persistFormValues,
  };
};

export default useFormPersistence;
export type { UseFormPersistenceOptions, UseFormPersistenceReturn, PersistedDataWrapper };
