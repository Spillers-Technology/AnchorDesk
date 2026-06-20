/**
 * SmtpMailTransport — nodemailer-backed MailTransport.
 *
 * Reads SMTP config from config.smtp (host/port/secure/auth/from). The transport
 * is created lazily on first send so the app boots fine with no SMTP configured;
 * isConfigured() gates the mail features in routes and the admin UI.
 */

import nodemailer from 'nodemailer';
import { MailTransport, OutboundMail } from './MailTransport';
import { getSmtp } from '../settingsService';

export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';

  async isConfigured(): Promise<boolean> {
    return Boolean((await getSmtp()).host);
  }

  /** Built per-send from the current (DB-backed) SMTP config so Admin edits
   *  take effect without a restart. */
  private async transporter() {
    const smtp = await getSmtp();
    if (!smtp.host) throw new Error('SMTP is not configured (set it in Admin → Integrations or SMTP_HOST)');
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  async send(mail: OutboundMail): Promise<{ messageId: string }> {
    const smtp = await getSmtp();
    const info = await (await this.transporter()).sendMail({
      from: smtp.from,
      to: mail.to,
      cc: mail.cc,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return { messageId: info.messageId };
  }
}

/** Singleton transport used across the app. */
export const mailTransport: MailTransport = new SmtpMailTransport();
