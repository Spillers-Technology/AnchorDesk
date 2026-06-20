/**
 * MailTransport — Strategy interface for outbound mail.
 *
 * The third pluggable seam (alongside TicketProvider and DeviceProvider). The
 * app sends mail without knowing whether it's an internal Postfix relay, a SaaS
 * provider, or (future) a per-tenant configured SMTP. SmtpMailTransport is the
 * reference implementation.
 *
 * GoF pattern: Strategy
 */

export interface OutboundMail {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string[];
  replyTo?: string;
}

export interface MailTransport {
  readonly name: string;

  /** True when the transport has enough config to actually send. Async because
   *  config now lives in the DB (editable in Admin), not just env. */
  isConfigured(): Promise<boolean>;

  /** Send a message. Returns the provider message id. */
  send(mail: OutboundMail): Promise<{ messageId: string }>;
}
