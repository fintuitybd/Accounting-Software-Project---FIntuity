import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig, EmailConfig, EmailTransportName } from '../config.ts';
import { generateToken } from './tokens.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
 * git-ignored local directory so a developer can complete the flow without a mail provider.
 */
export class FileEmailSender implements EmailSender {
  readonly transport = 'file' as const;
  readonly directory: string;

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

/**
 * Production SMTP / AWS SES delivery transport using nodemailer.
 */
export class SmtpEmailSender implements EmailSender {
  readonly transport = 'smtp' as const;
  readonly transporter: Transporter;
  readonly from: string;

  constructor(options: {
    transporter?: Transporter;
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
    from: string;
  }) {
    this.from = options.from;
    this.transporter =
      options.transporter ??
      nodemailer.createTransport({
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 587,
        secure: options.secure ?? false,
        auth: options.auth,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

export function createEmailSender(
  config: Partial<AppConfig> & {
    emailTransport?: EmailTransportName;
    emailOutboxDir?: string;
    emailFrom?: string;
    email?: EmailConfig;
  },
): EmailSender {
  const mode = config.email?.mode ?? config.emailTransport ?? 'file';

  // Retain deterministic JSON outbox file writing in test and file modes
  if (config.nodeEnv === 'test' || mode === 'file') {
    const dir = config.email?.outboxDir ?? config.emailOutboxDir ?? '.tmp/mail';
    return new FileEmailSender(path.resolve(dir));
  }

  if (mode === 'memory') {
    return new MemoryEmailSender();
  }

  if (mode === 'smtp') {
    return new SmtpEmailSender({
      host: config.email?.host,
      port: config.email?.port,
      secure: config.email?.secure,
      auth: config.email?.auth,
      from: config.email?.from ?? config.emailFrom ?? 'Fintuity Accounting Suite <no-reply@ledgervault.local>',
    });
  }

  return new FileEmailSender(path.resolve(config.email?.outboxDir ?? config.emailOutboxDir ?? '.tmp/mail'));
}
