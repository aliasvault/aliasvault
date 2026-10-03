/**
 * Minimal SMTP client, used to deliver test mail to a running AliasVault SMTP service.
 */
import { connect, type Socket } from 'node:net';

import { test } from '@playwright/test';

/**
 * Where the SMTP service listens: ALIASVAULT_SMTP_HOST / ALIASVAULT_SMTP_PORT, else port 25 of this machine
 * (the fixed port of `./scripts/dev.sh smtp`). IPv4 on purpose, so a Docker stack bound to [::]:25 is not hit instead.
 */
export function resolveSmtpTarget(): { host: string; port: number } {
  return {
    host: process.env.ALIASVAULT_SMTP_HOST || '127.0.0.1',
    port: Number(process.env.ALIASVAULT_SMTP_PORT || 25),
  };
}

/**
 * A message to send.
 */
export type TestMail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * Whether an SMTP service answers with its greeting.
 */
export async function isSmtpAvailable(): Promise<boolean> {
  try {
    const session = await SmtpSession.open();
    await session.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Skip the calling test (or describe block, from a beforeAll) when no SMTP service answers. CI starts the SMTP service,
 * so a missing one there is a failure, not a reason to skip.
 */
export async function requireSmtp(): Promise<void> {
  const { host, port } = resolveSmtpTarget();
  const available = await isSmtpAvailable();
  const hint = `No SMTP service at ${host}:${port}. Start it with ./scripts/dev.sh smtp, or set ALIASVAULT_SMTP_HOST / ALIASVAULT_SMTP_PORT.`;
  if (!available && process.env.CI) {
    throw new Error(hint);
  }
  test.skip(!available, hint);
}

/**
 * Send a message; throws with the server reply when any step is refused, e.g. when AliasVault rejects the recipient.
 */
export async function sendMail(mail: TestMail): Promise<void> {
  const session = await SmtpSession.open();
  try {
    await session.command('EHLO e2e.test', 250, 'EHLO');
    await session.command(`MAIL FROM:<${mail.from}>`, 250, 'MAIL FROM');
    await session.command(`RCPT TO:<${mail.to}>`, 250, 'RCPT TO');
    await session.command('DATA', 354, 'DATA');
    await session.command(`${buildMessage(mail)}\r\n.`, 250, 'message');
  } finally {
    await session.close();
  }
}

/**
 * A multipart/alternative message with a text and an HTML part.
 */
function buildMessage(mail: TestMail): string {
  const boundary = `e2e-${Date.now()}`;
  const lines = [
    `From: E2E Sender <${mail.from}>`,
    `To: <${mail.to}>`,
    `Subject: ${mail.subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    mail.text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    mail.html,
    `--${boundary}--`,
  ];
  // Dot-stuffing: a line starting with "." would otherwise end the DATA section early.
  return lines.map(line => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
}

/**
 * One SMTP connection that sends a command at a time and waits for its (possibly multi-line) reply.
 */
class SmtpSession {
  private buffer = '';
  private waiter: ((reply: string) => void) | null = null;

  /**
   * Wrap a connected socket.
   */
  private constructor(private readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.flush();
    });
  }

  /**
   * Connect and wait for the 220 greeting.
   */
  public static open(): Promise<SmtpSession> {
    const { host, port } = resolveSmtpTarget();
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port, timeout: 5000 });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error(`SMTP connection to ${host}:${port} timed out`));
      });
      socket.once('error', reject);
      socket.once('connect', () => {
        const session = new SmtpSession(socket);
        session.expect(220).then(() => resolve(session), reject);
      });
    });
  }

  /**
   * Send one command and check the reply code.
   */
  public async command(line: string, expectedCode: number, step: string): Promise<string> {
    this.socket.write(`${line}\r\n`);
    return this.expect(expectedCode, step);
  }

  /**
   * Say goodbye and close the connection.
   */
  public async close(): Promise<void> {
    if (!this.socket.destroyed) {
      this.socket.end('QUIT\r\n');
    }
  }

  /**
   * Wait for the next reply and check its code.
   */
  private async expect(expectedCode: number, step = 'greeting'): Promise<string> {
    const reply = await new Promise<string>((resolve) => {
      this.waiter = resolve;
      this.flush();
    });
    if (!reply.startsWith(String(expectedCode))) {
      throw new Error(`SMTP ${step} refused, expected ${expectedCode} but got: ${reply.trim()}`);
    }
    return reply;
  }

  /**
   * Hand a complete reply to the waiter; a reply ends at a line with a space after the code ("250 OK").
   */
  private flush(): void {
    if (!this.waiter) {
      return;
    }
    const lines = this.buffer.split('\r\n');
    const lastIndex = lines.findIndex(l => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (lastIndex === -1) {
      return;
    }
    const reply = lines.slice(0, lastIndex + 1).join('\n');
    this.buffer = lines.slice(lastIndex + 1).join('\r\n');
    const waiter = this.waiter;
    this.waiter = null;
    waiter(reply);
  }
}
