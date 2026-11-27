/**
 * Category 14: Custom proxy headers
 *
 * These tests verify the custom proxy headers of a self-hosted server: the advanced settings explain why a header name
 * cannot be used, and the headers that can are sent with the API requests. The API is a local server that records the
 * request headers and drops every connection, so the login also shows the message for an unreachable self-hosted server.
 */
import http from 'node:http';

import { test, expect, TestClient, waitForLoginForm } from '../fixtures';

import type { AddressInfo } from 'node:net';

/**
 * A local API that records the headers of each request and drops the connection, as an unreachable server would.
 */
type RecordingServer = {
  apiUrl: string;
  requests: http.IncomingHttpHeaders[];
  close: () => Promise<void>;
};

/**
 * Start a recording server on a free local port.
 */
async function startRecordingServer(): Promise<RecordingServer> {
  const requests: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((request) => {
    requests.push(request.headers);
    request.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    apiUrl: `http://127.0.0.1:${port}/api`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test.describe.serial('14. Custom proxy headers', () => {
  let client: TestClient;
  let server: RecordingServer;

  test.beforeAll(async () => {
    server = await startRecordingServer();
  });

  test.afterAll(async () => {
    await client?.cleanup();
    await server?.close();
  });

  test('14.1 should explain why a header name cannot be used', async ({ context, extensionId }) => {
    client = await TestClient.fromContext(context, extensionId);
    const popup = client.popup;

    await popup.locator('button#server-settings').click();
    await popup.locator('button#api-option-custom').click();
    await popup.locator('button#advanced-settings').click();
    await popup.locator('input#custom-api-url').fill(server.apiUrl);

    // No header fields until the user adds one
    await expect(popup.locator('input#custom-header-name-0')).toHaveCount(0);
    await popup.locator('button#add-custom-header').click();

    const name = popup.locator('input#custom-header-name-0');
    await name.fill('X Proxy Token');
    await expect(popup.getByText('Not a valid HTTP header name.')).toBeVisible();

    await name.fill('X-AliasVault-Client');
    await expect(popup.getByText('AliasVault already sends this HTTP header.')).toBeVisible();

    // Other names with the X-AliasVault- prefix are allowed
    await name.fill('X-AliasVault-Proxy-Token');
    await expect(popup.getByText('AliasVault already sends this HTTP header.')).toBeHidden();
    await popup.locator('input#custom-header-value-0').fill('proxy-secret');

    // A reserved name keeps its error and is not stored
    await popup.locator('button#add-custom-header').click();
    await popup.locator('input#custom-header-name-1').fill('Authorization');
    await popup.locator('input#custom-header-value-1').fill('Bearer not-sent');
    await expect(popup.getByText('AliasVault already sends this HTTP header.')).toBeVisible();

    await popup.click('button#back');
    await popup.locator('button#api-option-custom').waitFor({ state: 'visible' });
    await popup.click('button#back');
    await waitForLoginForm(popup);
  });

  test('14.2 should send the custom headers with API requests', async () => {
    await client.attemptLogin('proxy-headers@example.tld', 'password');

    await expect.poll(() => server.requests.length, { timeout: 10000 }).toBeGreaterThan(0);
    for (const headers of server.requests) {
      expect(headers['x-aliasvault-proxy-token']).toBe('proxy-secret');
      expect(headers['authorization']).toBeUndefined();
    }

    // The unreachable self-hosted server is named in the error, so the user can check it
    await expect(client.popup.getByText(`Could not reach your AliasVault server at ${server.apiUrl}.`, { exact: false })).toBeVisible({ timeout: 10000 });
  });
});
