import type { WebApiService } from '../api/WebApiService';

/** Most email ids the server accepts in one bulk delete. */
const MAX_IDS_PER_REQUEST = 500;

/**
 * Response of a bulk email delete.
 */
type EmailBulkResponse = {
  successfulEmailIds: number[];
};

/**
 * Delete emails from the mailbox, in batches the server accepts.
 * @param webApi - The API client
 * @param emailIds - The ids of the emails to delete
 * @returns The ids the server deleted
 */
export async function deleteEmails(webApi: WebApiService, emailIds: number[]): Promise<number[]> {
  const deleted: number[] = [];
  for (let start = 0; start < emailIds.length; start += MAX_IDS_PER_REQUEST) {
    const ids = emailIds.slice(start, start + MAX_IDS_PER_REQUEST);
    const response = await webApi.authFetch<EmailBulkResponse>('Email/bulk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    deleted.push(...(response?.successfulEmailIds ?? []));
  }
  return deleted;
}
