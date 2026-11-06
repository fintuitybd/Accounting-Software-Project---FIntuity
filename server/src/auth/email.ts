import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, EmailTransportName } from '../config.ts';
import { generateToken } from './tokens.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  readonly transport: EmailTransportName;
  send(message: EmailMessage): Promise<void>;
}

export class MemoryEmailSender implements EmailSender {
  readonly transport = 'memory' as const;
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

/**
 * Development/test outbox. It writes the complete message (including the one-time link) to a
 * git-ignored local directory so a developer can complete the flow without a mail provider. It is
 * not production delivery; the Phase 3 completion report records the SMTP/provider decision.
 */
export class FileEmailSender implements EmailSender {
  readonly transport = 'file' as const;
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${generateToken(6)}.json`;
    await writeFile(
      path.join(this.directory, fileName),
      JSON.stringify({ ...message, createdAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  }
}

export function createEmailSender(config: Pick<AppConfig, 'emailTransport' | 'emailOutboxDir'>): EmailSender {
  return config.emailTransport === 'memory'
    ? new MemoryEmailSender()
    : new FileEmailSender(path.resolve(config.emailOutboxDir));
}
