import nodemailer from 'nodemailer';
import { env } from '../config/env';
import {
  Affiliate,
  AffiliateCommission,
  EmailBrandingConfig,
  EmailSendLog,
  Order,
  PaymentTransaction,
  SiteSettings,
} from '../types';
import { EmailSendLogModel, OrderModel, SiteSettingsModel } from '../models';
import { DEFAULT_EMAIL_BRANDING, getInitialSettings } from '../utils/seedData';
import { auditService } from './audit.service';
import { isSafeHttpUrl, sanitizeRichHtml } from '../utils/security';

const formatEmailDateTime = (isoDate?: string): string => {
  const date = isoDate ? new Date(isoDate) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  try {
    const formatted = new Intl.DateTimeFormat('en-NG', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(safeDate);
    return `${formatted} (WAT)`;
  } catch {
    return `${safeDate.toISOString().replace('T', ' ').substring(0, 19)} UTC`;
  }
};

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  includeDiagnostics?: boolean;
}

export interface BrandedEmailOptions {
  recipientName?: string;
  recipientEmail?: string;
  subject: string;
  greeting?: string;
  bodyHtml: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  preheader?: string;
  isPromotional?: boolean;
  unsubscribeToken?: string;
  sendLogId?: string;
  settings?: Partial<SiteSettings>;
}

export interface EmailSendResult {
  success: boolean;
  sent: boolean;
  provider: 'brevo' | 'brevo-smtp' | 'smtp' | 'none';
  simulated?: boolean;
  messageId?: string;
  fromEmail?: string;
  toEmail?: string;
  brevoEvents?: Array<{ event?: string; email?: string; reason?: string; date?: string; subject?: string }>;
  verifiedSenders?: Array<{ email: string; active: boolean }>;
  error?: string;
}

interface BrevoSender {
  id?: number;
  name?: string;
  email: string;
  active: boolean;
}

let cachedSenders: { fetchedAt: number; senders: BrevoSender[] } | null = null;

export const escapeHtml = (input: string): string =>
  String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const personalizeTemplate = (template: string, fullName?: string): string => {
  const cleanName = (fullName || '').trim();
  const firstName = cleanName ? cleanName.split(/\s+/)[0] : 'there';
  const displayFull = cleanName || 'Valued Customer';
  return String(template || '')
    .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*(fullName|name)\s*\}\}/gi, displayFull);
};

let runtimeAppUrl = '';

const isPlaceholderOrLegacyUrl = (raw?: string): boolean => {
  const val = (raw || '').trim().toLowerCase();
  if (!val) return true;
  if (val.includes('my_app_url')) return true;
  if (/^https?:\/\/(www\.)?zeeksoftwares\.com(\/|$)/i.test(val)) return true;
  return false;
};

const isLocalhostUrl = (raw?: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test((raw || '').trim());

export const setRuntimeAppUrl = (origin?: string): void => {
  const clean = (origin || '').trim().replace(/\/$/, '');
  if (!clean || !/^https?:\/\//i.test(clean)) return;
  if (isLocalhostUrl(clean) && runtimeAppUrl && !isLocalhostUrl(runtimeAppUrl)) return;
  runtimeAppUrl = clean;
};

export const getPublicAppUrl = (): string => {
  const configured = (env.appUrl || '').trim().replace(/\/$/, '');
  if (configured && !isPlaceholderOrLegacyUrl(configured)) {
    if (!isLocalhostUrl(configured) || !runtimeAppUrl) {
      return configured;
    }
  }
  if (runtimeAppUrl && !isPlaceholderOrLegacyUrl(runtimeAppUrl)) {
    return runtimeAppUrl;
  }
  return configured || 'http://localhost:3000';
};

const resolveAbsoluteUrl = (rawUrl: string, baseUrl: string): string => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return baseUrl;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${baseUrl}${trimmed}`;
  return `https://${trimmed}`;
};

const wrapTrackedUrl = (targetUrl: string, sendLogId?: string, appBaseUrl?: string): string => {
  if (!sendLogId || !appBaseUrl || !/^https?:\/\//i.test(targetUrl)) return targetUrl;
  return `${appBaseUrl}/api/email/track/click/${encodeURIComponent(sendLogId)}?url=${encodeURIComponent(targetUrl)}`;
};

const loadBrandingSettings = async (override?: Partial<SiteSettings>): Promise<SiteSettings> => {
  const defaults = getInitialSettings();
  try {
    const doc = await SiteSettingsModel.findOne({ key: 'site_settings' }).lean();
    return {
      ...defaults,
      ...(doc || {}),
      ...(override || {}),
      emailBranding: {
        ...DEFAULT_EMAIL_BRANDING,
        ...(doc?.emailBranding || {}),
        ...(override?.emailBranding || {}),
      },
    } as SiteSettings;
  } catch {
    return {
      ...defaults,
      ...(override || {}),
      emailBranding: {
        ...DEFAULT_EMAIL_BRANDING,
        ...(override?.emailBranding || {}),
      },
    };
  }
};

export const buildBrandedEmailContent = async (
  opts: BrandedEmailOptions
): Promise<{ subject: string; html: string; text: string }> => {
  const settings = await loadBrandingSettings(opts.settings);
  const appBase = getPublicAppUrl();
  const configuredSiteUrl = (settings.emailBranding?.websiteUrl || '').trim();
  const websiteUrl =
    isPlaceholderOrLegacyUrl(configuredSiteUrl) ||
    (isLocalhostUrl(configuredSiteUrl) && !isLocalhostUrl(appBase))
      ? appBase
      : resolveAbsoluteUrl(configuredSiteUrl, appBase);
  const storeName = settings.storeName || 'Zeek Softwares';
  const primaryColor = settings.primaryColor || '#061B45';
  const accentColor = settings.accentColor || '#FF7900';

  const rawLogo = settings.lightLogoUrl || settings.logoUrl || '';
  const logoUrl = rawLogo ? resolveAbsoluteUrl(rawLogo, appBase) : '';

  const personalizedSubject = personalizeTemplate(opts.subject, opts.recipientName);
  const personalizedGreeting = opts.greeting
    ? personalizeTemplate(opts.greeting, opts.recipientName)
    : '';

  const sanitizedBodyHtml = sanitizeRichHtml(opts.bodyHtml);
  const bodyProcessed = personalizeTemplate(sanitizedBodyHtml, opts.recipientName).replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_m, url: string) =>
      opts.sendLogId
        ? `href="${escapeHtml(wrapTrackedUrl(url, opts.sendLogId, appBase))}"`
        : `href="${escapeHtml(url)}"`
  );

  const rawCtaUrl = opts.ctaUrl ? resolveAbsoluteUrl(opts.ctaUrl, websiteUrl) : '';
  const resolvedCtaUrl = isSafeHttpUrl(rawCtaUrl) ? rawCtaUrl : '';
  const trackedCtaUrl = resolvedCtaUrl
    ? wrapTrackedUrl(resolvedCtaUrl, opts.sendLogId, appBase)
    : '';

  const rawBanner = opts.imageUrl ? resolveAbsoluteUrl(opts.imageUrl, appBase) : '';
  const resolvedBanner = isSafeHttpUrl(rawBanner) ? rawBanner : '';
  const cleanWhatsApp = (settings.internationalWhatsApp || '2347045200361').replace(/\D/g, '');
  const unsubscribeUrl = opts.unsubscribeToken
    ? `${appBase}/preferences/${encodeURIComponent(opts.unsubscribeToken)}`
    : '';

  const socialLinks: Array<{ label: string; url: string }> = [];
  if (settings.whatsappCommunityUrl) {
    socialLinks.push({ label: 'WhatsApp Community', url: settings.whatsappCommunityUrl });
  }
  if (settings.telegramChannelUrl) {
    socialLinks.push({ label: 'Telegram Channel', url: settings.telegramChannelUrl });
  }
  if (settings.emailBranding?.facebookUrl) {
    socialLinks.push({ label: 'Facebook', url: settings.emailBranding.facebookUrl });
  }
  if (settings.emailBranding?.instagramUrl) {
    socialLinks.push({ label: 'Instagram', url: settings.emailBranding.instagramUrl });
  }
  if (settings.emailBranding?.twitterUrl) {
    socialLinks.push({ label: 'X / Twitter', url: settings.emailBranding.twitterUrl });
  }
  if (settings.emailBranding?.youtubeUrl) {
    socialLinks.push({ label: 'YouTube', url: settings.emailBranding.youtubeUrl });
  }

  const trackingPixelHtml =
    opts.sendLogId && opts.isPromotional
      ? `<img src="${escapeHtml(`${appBase}/api/email/track/open/${encodeURIComponent(opts.sendLogId)}`)}" width="1" height="1" alt="" style="display:block;border:0;outline:none;" />`
      : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(personalizedSubject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
  ${
    opts.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
          personalizeTemplate(opts.preheader, opts.recipientName)
        )}</div>`
      : ''
  }
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F1F5F9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 20px rgba(6,27,69,0.06);">
          <!-- Official Branded Header -->
          <tr>
            <td style="background-color:${escapeHtml(primaryColor)};padding:24px 28px;border-bottom:4px solid ${escapeHtml(accentColor)};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <a href="${escapeHtml(websiteUrl)}" style="text-decoration:none;color:#FFFFFF;display:inline-flex;align-items:center;gap:12px;">
                      ${
                        logoUrl
                          ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(
                              storeName
                            )}" style="max-height:42px;width:auto;display:block;border-radius:6px;" />`
                          : ''
                      }
                      <span style="font-size:20px;font-weight:900;letter-spacing:-0.02em;color:#FFFFFF;">${escapeHtml(
                        storeName
                      )}</span>
                    </a>
                    ${
                      settings.tagline
                        ? `<p style="margin:6px 0 0;font-size:12px;color:#CBD5E1;">${escapeHtml(
                            settings.tagline
                          )}</p>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Optional Banner Image -->
          ${
            resolvedBanner
              ? `<tr>
                  <td style="padding:0;background-color:#F8FAFC;">
                    <img src="${escapeHtml(resolvedBanner)}" alt="" style="width:100%;max-height:280px;object-fit:cover;display:block;border:0;" />
                  </td>
                </tr>`
              : ''
          }

          <!-- Email Body -->
          <tr>
            <td style="padding:28px 28px 20px;font-size:15px;line-height:1.65;color:#1E293B;">
              ${
                personalizedGreeting
                  ? `<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:${escapeHtml(
                      primaryColor
                    )};">${escapeHtml(personalizedGreeting)}</p>`
                  : ''
              }
              <div style="font-size:15px;line-height:1.65;color:#334155;">
                ${bodyProcessed}
              </div>

              ${
                opts.ctaLabel && trackedCtaUrl
                  ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 8px;">
                      <tr>
                        <td style="border-radius:10px;background-color:${escapeHtml(accentColor)};">
                          <a href="${escapeHtml(
                            trackedCtaUrl
                          )}" target="_blank" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:800;color:#FFFFFF;text-decoration:none;letter-spacing:0.02em;">
                            ${escapeHtml(opts.ctaLabel)}
                          </a>
                        </td>
                      </tr>
                    </table>`
                  : ''
              }
            </td>
          </tr>

          <!-- Official Branded Footer -->
          <tr>
            <td style="background-color:#F8FAFC;padding:22px 28px;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.6;color:#64748B;">
              <p style="margin:0 0 8px;font-weight:700;color:${escapeHtml(primaryColor)};font-size:13px;">
                ${escapeHtml(storeName)}
              </p>
              <p style="margin:0 0 8px;">
                Website: <a href="${escapeHtml(websiteUrl)}" style="color:${escapeHtml(
    accentColor
  )};text-decoration:none;font-weight:600;">${escapeHtml(websiteUrl)}</a><br/>
                Email: <a href="mailto:${escapeHtml(settings.supportEmail)}" style="color:#334155;text-decoration:none;">${escapeHtml(
    settings.supportEmail
  )}</a>
                ${
                  settings.supportWhatsApp
                    ? ` • WhatsApp: <a href="https://wa.me/${escapeHtml(
                        cleanWhatsApp
                      )}" style="color:#16A34A;text-decoration:none;font-weight:600;">${escapeHtml(
                        settings.supportWhatsApp
                      )}</a>`
                    : ''
                }
              </p>
              ${
                socialLinks.length > 0
                  ? `<p style="margin:8px 0;">
                      ${socialLinks
                        .map(
                          (sl) =>
                            `<a href="${escapeHtml(
                              sl.url
                            )}" target="_blank" style="color:${escapeHtml(
                              primaryColor
                            )};text-decoration:underline;margin-right:12px;font-weight:600;">${escapeHtml(
                              sl.label
                            )}</a>`
                        )
                        .join('')}
                    </p>`
                  : ''
              }
              ${
                settings.emailBranding?.footerNote
                  ? `<p style="margin:10px 0 0;color:#64748B;font-size:11px;">${escapeHtml(
                      settings.emailBranding.footerNote
                    )}</p>`
                  : ''
              }
              ${
                opts.isPromotional && unsubscribeUrl
                  ? `<p style="margin:12px 0 0;padding-top:10px;border-top:1px solid #E2E8F0;font-size:11px;color:#64748B;">
                      No longer wish to receive promotional emails?
                      <a href="${escapeHtml(
                        unsubscribeUrl
                      )}" style="color:#DC2626;font-weight:700;text-decoration:underline;">Unsubscribe or manage email preferences</a>.
                    </p>`
                  : ''
              }
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  ${trackingPixelHtml}
</body>
</html>`.trim();

  const plainBody = bodyProcessed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

  const text =
    `${storeName}\n` +
    `${personalizedGreeting ? `${personalizedGreeting}\n\n` : ''}` +
    `${plainBody}\n\n` +
    `${opts.ctaLabel && resolvedCtaUrl ? `${opts.ctaLabel}: ${resolvedCtaUrl}\n\n` : ''}` +
    `---\n` +
    `${storeName} • ${websiteUrl}\n` +
    `Support: ${settings.supportEmail}${settings.supportWhatsApp ? ` | WhatsApp: ${settings.supportWhatsApp}` : ''}` +
    `${opts.isPromotional && unsubscribeUrl ? `\nUnsubscribe / Preferences: ${unsubscribeUrl}` : ''}`;

  return { subject: personalizedSubject, html, text };
};

const parseConfiguredSender = (): { name: string; email: string; explicit: boolean } => {
  const rawFrom = env.emailFrom;
  if (rawFrom) {
    const match = rawFrom.match(/^(.+?)\s*<([^>]+)>$/);
    if (match) {
      return {
        name: match[1].trim().replace(/^["']|["']$/g, '') || env.brevoSenderName,
        email: match[2].trim(),
        explicit: true,
      };
    }
    if (rawFrom.includes('@')) {
      return {
        name: env.brevoSenderName,
        email: rawFrom.trim(),
        explicit: true,
      };
    }
  }

  if (env.brevoSenderEmail) {
    return {
      name: env.brevoSenderName || 'Zeek Softwares',
      email: env.brevoSenderEmail,
      explicit: true,
    };
  }

  return {
    name: env.brevoSenderName || 'Zeek Softwares',
    email:
      (env.smtpUser.includes('@') ? env.smtpUser : '') ||
      env.contactRecipientEmail ||
      'Zeeksoftwares@gmail.com',
    explicit: false,
  };
};

const fetchBrevoSenders = async (apiKey: string): Promise<BrevoSender[]> => {
  const now = Date.now();
  if (cachedSenders && now - cachedSenders.fetchedAt < 60_000) {
    return cachedSenders.senders;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/senders', {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { senders?: BrevoSender[] };
    const senders = Array.isArray(json.senders) ? json.senders : [];
    cachedSenders = { fetchedAt: now, senders };
    return senders;
  } catch {
    return [];
  }
};

const fetchBrevoRecentEvents = async (
  apiKey: string,
  recipientEmail?: string,
  messageId?: string
): Promise<
  Array<{ event?: string; email?: string; reason?: string; date?: string; subject?: string; messageId?: string }>
> => {
  try {
    const qs = new URLSearchParams({ limit: '15', sort: 'desc' });
    if (recipientEmail) qs.set('email', recipientEmail);
    const res = await fetch(`https://api.brevo.com/v3/smtp/statistics/events?${qs.toString()}`, {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      events?: Array<{
        event?: string;
        email?: string;
        reason?: string;
        date?: string;
        subject?: string;
        messageId?: string;
      }>;
    };
    const events = Array.isArray(json.events) ? json.events : [];
    if (messageId) {
      const normalizedId = messageId.replace(/[<>]/g, '');
      return events.filter((e) => (e.messageId || '').replace(/[<>]/g, '') === normalizedId);
    }
    return events.slice(0, 5);
  } catch {
    return [];
  }
};

const getSmtpConfig = () => {
  const user = env.smtpUser;
  const pass = env.smtpPass;
  const host = env.smtpHost || (user && pass ? 'smtp-relay.brevo.com' : '');
  if (!host) return null;

  const isBrevoRelay = host.toLowerCase().includes('brevo.com');
  const port = env.smtpHost ? env.smtpPort || 587 : 587;
  const secure = env.smtpHost ? env.smtpSecure : false;

  return {
    host,
    port,
    secure,
    isBrevoRelay,
    auth: user && pass ? { user, pass } : undefined,
  };
};

export interface EmailProviderDiagnostics {
  configured: boolean;
  activeProvider: 'brevo' | 'brevo-smtp' | 'smtp' | 'none';
  providerLabel: string;
  sender: {
    name: string;
    email: string;
    explicit: boolean;
  };
  smtp: {
    configured: boolean;
    host: string | null;
    port: number;
    secure: boolean;
    hasAuth: boolean;
    isBrevoRelay: boolean;
  };
  envVars: {
    BREVO_API_KEY: boolean;
    BREVO_SENDER_EMAIL: boolean;
    BREVO_SENDER_NAME: boolean;
    CONTACT_EMAIL: boolean;
    SMTP_HOST: boolean;
    SMTP_PORT: boolean;
    SMTP_SECURE: boolean;
    SMTP_USER: boolean;
    SMTP_PASS: boolean;
    EMAIL_FROM: boolean;
  };
  endpoints: {
    brevoRestApi: string;
    brevoSendersApi: string;
    statusApi: string;
    verifyApi: string;
    testEmailApi: string;
  };
  liveCheck?: {
    checkedAt: string;
    brevoApiOk?: boolean;
    brevoError?: string;
    verifiedSenders?: Array<{ email: string; active: boolean; name?: string }>;
    smtpOk?: boolean;
    smtpError?: string;
  };
}

export const emailService = {
  getProviderStatus(): {
    configured: boolean;
    provider: 'brevo' | 'brevo-smtp' | 'smtp' | 'none';
  } {
    if (env.brevoApiKey) return { configured: true, provider: 'brevo' };
    const smtp = getSmtpConfig();
    if (smtp) {
      return { configured: true, provider: smtp.isBrevoRelay ? 'brevo-smtp' : 'smtp' };
    }
    return { configured: false, provider: 'none' };
  },

  async getDetailedProviderDiagnostics(verifyLive = false): Promise<EmailProviderDiagnostics> {
    const basic = this.getProviderStatus();
    const sender = parseConfiguredSender();
    const smtpConfig = getSmtpConfig();

    const providerLabel =
      basic.provider === 'brevo'
        ? 'Brevo Transactional Email API v3'
        : basic.provider === 'brevo-smtp'
        ? 'Brevo SMTP Relay (smtp-relay.brevo.com)'
        : basic.provider === 'smtp'
        ? `Custom SMTP Server (${smtpConfig?.host || 'configured'})`
        : 'Not Configured (Add BREVO_API_KEY or SMTP_* in Secrets)';

    const diagnostics: EmailProviderDiagnostics = {
      configured: basic.configured,
      activeProvider: basic.provider,
      providerLabel,
      sender,
      smtp: {
        configured: Boolean(smtpConfig),
        host: smtpConfig?.host || null,
        port: smtpConfig?.port || env.smtpPort || 587,
        secure: smtpConfig ? smtpConfig.secure : env.smtpSecure,
        hasAuth: Boolean(smtpConfig?.auth),
        isBrevoRelay: Boolean(smtpConfig?.isBrevoRelay),
      },
      envVars: {
        BREVO_API_KEY: Boolean(env.brevoApiKey),
        BREVO_SENDER_EMAIL: Boolean(env.brevoSenderEmail),
        BREVO_SENDER_NAME: Boolean(process.env.BREVO_SENDER_NAME),
        CONTACT_EMAIL: Boolean(env.contactRecipientEmail),
        SMTP_HOST: Boolean(env.smtpHost),
        SMTP_PORT: Boolean(process.env.SMTP_PORT),
        SMTP_SECURE: Boolean(process.env.SMTP_SECURE),
        SMTP_USER: Boolean(env.smtpUser),
        SMTP_PASS: Boolean(env.smtpPass),
        EMAIL_FROM: Boolean(env.emailFrom),
      },
      endpoints: {
        brevoRestApi: 'https://api.brevo.com/v3/smtp/email',
        brevoSendersApi: 'https://api.brevo.com/v3/senders',
        statusApi: '/api/admin/email/provider-status',
        verifyApi: '/api/admin/email/provider-status?verify=true',
        testEmailApi: '/api/admin/email/test',
      },
    };

    if (verifyLive) {
      const liveCheck: NonNullable<EmailProviderDiagnostics['liveCheck']> = {
        checkedAt: new Date().toISOString(),
      };

      if (env.brevoApiKey) {
        try {
          const res = await fetch('https://api.brevo.com/v3/senders', {
            headers: { 'api-key': env.brevoApiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const json = (await res.json()) as { senders?: BrevoSender[] };
            const senders = Array.isArray(json.senders) ? json.senders : [];
            cachedSenders = { fetchedAt: Date.now(), senders };
            liveCheck.brevoApiOk = true;
            liveCheck.verifiedSenders = senders.map((s) => ({
              email: s.email,
              active: Boolean(s.active),
              name: s.name,
            }));
          } else {
            const text = await res.text().catch(() => '');
            liveCheck.brevoApiOk = false;
            liveCheck.brevoError = `Brevo API returned HTTP ${res.status}${text ? `: ${text.slice(0, 160)}` : ''}`;
          }
        } catch (err) {
          liveCheck.brevoApiOk = false;
          liveCheck.brevoError = err instanceof Error ? err.message : 'Brevo API connection check failed';
        }
      }

      if (smtpConfig) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure,
            connectionTimeout: 6000,
            greetingTimeout: 6000,
            ...(smtpConfig.auth ? { auth: smtpConfig.auth } : {}),
          });
          await transporter.verify();
          liveCheck.smtpOk = true;
        } catch (err) {
          liveCheck.smtpOk = false;
          liveCheck.smtpError = err instanceof Error ? err.message : 'SMTP handshake verification failed';
        }
      }

      diagnostics.liveCheck = liveCheck;
    }

    return diagnostics;
  },

  async fetchAccountEvents(limit = 50) {
    if (!env.brevoApiKey) return [];
    return fetchBrevoRecentEvents(env.brevoApiKey, undefined, undefined).catch(() => []);
  },

  async sendEmail(payload: EmailPayload): Promise<EmailSendResult> {
    const errors: string[] = [];
    const configuredSender = parseConfiguredSender();

    // 1. Primary: Brevo Transactional Email API v3 (https://api.brevo.com/v3/smtp/email)
    if (env.brevoApiKey) {
      try {
        const senders = await fetchBrevoSenders(env.brevoApiKey);
        const activeSenders = senders.filter((s) => s.active);
        const isConfiguredVerified = activeSenders.some(
          (s) => s.email.toLowerCase() === configuredSender.email.toLowerCase()
        );

        let effectiveSender = configuredSender;
        if (!isConfiguredVerified && activeSenders.length > 0) {
          console.warn(
            `[EmailService] Configured sender "${configuredSender.email}" is not verified in Brevo. Falling back to verified sender "${activeSenders[0].email}".`
          );
          effectiveSender = {
            name: activeSenders[0].name || configuredSender.name,
            email: activeSenders[0].email,
            explicit: true,
          };
        }

        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': env.brevoApiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            sender: {
              name: effectiveSender.name,
              email: effectiveSender.email,
            },
            to: [{ email: payload.to }],
            ...(payload.replyTo ? { replyTo: { email: payload.replyTo } } : {}),
            subject: payload.subject,
            textContent: payload.text,
            htmlContent: payload.html || escapeHtml(payload.text).replace(/\n/g, '<br/>'),
          }),
        });

        const rawBody = await res.text();
        let data: { messageId?: string; message?: string; code?: string } = {};
        try {
          data = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          data = { message: rawBody };
        }

        if (res.ok && data.messageId) {
          let recentEvents: Array<{
            event?: string;
            email?: string;
            reason?: string;
            date?: string;
            subject?: string;
          }> = [];
          if (payload.includeDiagnostics) {
            await new Promise((r) => setTimeout(r, 1500));
            recentEvents = await fetchBrevoRecentEvents(env.brevoApiKey, payload.to, data.messageId);
          }

          const failureEvent = recentEvents.find((ev) =>
            ['error', 'blocked', 'hardBounces', 'hard_bounce', 'invalid'].includes(ev.event || '')
          );

          const verifiedSummary =
            senders.length > 0
              ? senders.map((s) => `${s.email}(${s.active ? 'active' : 'inactive'})`).join(', ')
              : 'none-found';
          const eventsSummary =
            recentEvents.length > 0
              ? ` | Events: ${recentEvents
                  .map((ev) => `${ev.event || '?'}${ev.reason ? `[${ev.reason}]` : ''}@${ev.date || ''}`)
                  .join('; ')}`
              : '';

          await auditService.addLog(
            failureEvent ? 'Email Failed (Brevo)' : 'Email Sent (Brevo)',
            `From: ${effectiveSender.email} | To: ${payload.to} | Senders: ${verifiedSummary} | Subject: ${payload.subject} | ID: ${data.messageId}${eventsSummary}`,
            'System Email'
          );

          return {
            success: !failureEvent,
            sent: !failureEvent,
            provider: 'brevo',
            messageId: data.messageId,
            fromEmail: effectiveSender.email,
            toEmail: payload.to,
            verifiedSenders: senders.map((s) => ({ email: s.email, active: s.active })),
            ...(recentEvents.length > 0 ? { brevoEvents: recentEvents } : {}),
            ...(failureEvent ? { error: failureEvent.reason || failureEvent.event } : {}),
          };
        }

        const errMsg = data?.message || data?.code || `HTTP ${res.status}`;
        errors.push(`Brevo API: ${errMsg}`);
        console.error('[EmailService] Brevo API rejected email:', errMsg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Brevo API: ${msg}`);
        console.error('[EmailService] Failed to send email via Brevo API:', msg);
      }
    }

    // 2. Fallback / Alternative: Brevo SMTP Relay (smtp-relay.brevo.com) or configured SMTP
    const smtpConfig = getSmtpConfig();
    if (smtpConfig) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          ...(smtpConfig.auth ? { auth: smtpConfig.auth } : {}),
        });

        const info = await transporter.sendMail({
          from: `${configuredSender.name} <${configuredSender.email}>`,
          to: payload.to,
          ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
          subject: payload.subject,
          text: payload.text,
          html: payload.html || escapeHtml(payload.text).replace(/\n/g, '<br/>'),
        });

        const providerTag = smtpConfig.isBrevoRelay ? 'Brevo SMTP' : 'SMTP';
        await auditService.addLog(
          `Email Sent (${providerTag})`,
          `From: ${configuredSender.email} | To: ${payload.to} | Subject: ${payload.subject} | ID: ${info.messageId}`,
          'System Email'
        );

        return {
          success: true,
          sent: true,
          provider: smtpConfig.isBrevoRelay ? 'brevo-smtp' : 'smtp',
          messageId: info.messageId,
          fromEmail: configuredSender.email,
          toEmail: payload.to,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`SMTP: ${msg}`);
        console.error('[EmailService] Failed to send email via SMTP:', msg);
      }
    }

    const reason =
      errors.length > 0
        ? errors.join(' | ')
        : 'Brevo credentials not configured (set BREVO_API_KEY and BREVO_SENDER_EMAIL / EMAIL_FROM)';

    console.warn(`[EmailService] Email NOT sent (${reason}) | To: ${payload.to} | Subject: ${payload.subject}`);
    await auditService.addLog(
      'Email Not Dispatched',
      `From: ${configuredSender.email} | Recipient: ${payload.to} | Subject: ${payload.subject} | Reason: ${reason}`,
      'System Email Engine'
    );

    return {
      success: false,
      sent: false,
      provider: 'none',
      simulated: true,
      fromEmail: configuredSender.email,
      toEmail: payload.to,
      error: reason,
    };
  },

  async sendBrandedEmail(opts: BrandedEmailOptions & { to: string; replyTo?: string; includeDiagnostics?: boolean }) {
    const built = await buildBrandedEmailContent(opts);
    return this.sendEmail({
      to: opts.to,
      subject: built.subject,
      text: built.text,
      html: built.html,
      replyTo: opts.replyTo,
      includeDiagnostics: opts.includeDiagnostics,
    });
  },

  async notifySupportContactInquiry(data: {
    inquiryId: string;
    fullName: string;
    email: string;
    whatsApp?: string;
    subject: string;
    message: string;
    recipientEmail: string;
  }): Promise<EmailSendResult> {
    const recipient = env.contactRecipientEmail || data.recipientEmail || 'Zeeksoftwares@gmail.com';
    const bodyHtml = `
      <p style="margin:0 0 10px;">A new support message was submitted via the Contact Form.</p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin:0 0 14px;">
        <p style="margin:0 0 6px;"><strong>Inquiry ID:</strong> ${escapeHtml(data.inquiryId)}</p>
        <p style="margin:0 0 6px;"><strong>From:</strong> ${escapeHtml(data.fullName)}</p>
        <p style="margin:0 0 6px;"><strong>Reply Email:</strong> ${escapeHtml(data.email)}</p>
        <p style="margin:0 0 6px;"><strong>WhatsApp:</strong> ${escapeHtml(data.whatsApp || 'Not provided')}</p>
        <p style="margin:0;"><strong>Subject:</strong> ${escapeHtml(data.subject)}</p>
      </div>
      <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:14px;white-space:pre-wrap;">${escapeHtml(
        data.message
      )}</div>
      <p style="margin:14px 0 0;font-size:12px;color:#64748B;">Hit Reply in your inbox to respond directly to ${escapeHtml(
        data.email
      )}.</p>
    `;

    return this.sendBrandedEmail({
      to: recipient,
      replyTo: data.email,
      recipientName: 'Support Team',
      subject: `[Contact Form] ${data.subject} — ${data.fullName}`,
      greeting: 'New Contact Inquiry Received',
      bodyHtml,
      isPromotional: false,
      includeDiagnostics: true,
    });
  },

  async notifyAdminNewWithdrawal(data: {
    affiliateName: string;
    affiliateEmail: string;
    amount: number;
    bankName: string;
    accountNumber: string;
    reference: string;
    date: string;
  }) {
    const bodyHtml = `
      <p>A new affiliate withdrawal request has been submitted and requires Admin review.</p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>Affiliate Name:</strong> ${escapeHtml(data.affiliateName)}</p>
        <p style="margin:0 0 6px;"><strong>Affiliate Email:</strong> ${escapeHtml(data.affiliateEmail)}</p>
        <p style="margin:0 0 6px;"><strong>Withdrawal Amount:</strong> ₦${data.amount.toLocaleString('en-NG')}</p>
        <p style="margin:0 0 6px;"><strong>Bank Name:</strong> ${escapeHtml(data.bankName)}</p>
        <p style="margin:0 0 6px;"><strong>Reference:</strong> ${escapeHtml(data.reference)}</p>
        <p style="margin:0;"><strong>Date:</strong> ${escapeHtml(data.date)}</p>
      </div>
      <p>Please log in to the Admin Dashboard to review and process this payout.</p>
    `;

    return this.sendBrandedEmail({
      to: env.contactRecipientEmail || 'Zeeksoftwares@gmail.com',
      recipientName: 'Zeek Softwares Admin',
      subject: `New Affiliate Withdrawal Request — ₦${data.amount.toLocaleString('en-NG')} (${data.reference})`,
      greeting: 'Hello Zeek Softwares Admin,',
      bodyHtml,
      isPromotional: false,
    });
  },

  async notifyAffiliateWithdrawalSuccess(data: {
    affiliateName: string;
    affiliateEmail: string;
    amount: number;
    bankName: string;
    maskedAccount: string;
    accountName?: string;
    reference: string;
    transferReference?: string;
    processedAt?: string;
  }) {
    const paidAt = (data.processedAt || new Date().toISOString()).replace('T', ' ').substring(0, 19);
    const txRef = data.transferReference || data.reference;
    const bodyHtml = `
      <p>Good news! Your affiliate withdrawal request has been <strong>approved and processed successfully</strong>.</p>
      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:14px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>Withdrawal Amount:</strong> ₦${data.amount.toLocaleString('en-NG')}</p>
        <p style="margin:0 0 6px;"><strong>Request ID:</strong> ${escapeHtml(data.reference)}</p>
        <p style="margin:0 0 6px;"><strong>Transaction Reference:</strong> ${escapeHtml(txRef)}</p>
        <p style="margin:0 0 6px;"><strong>Bank Name:</strong> ${escapeHtml(data.bankName)}</p>
        <p style="margin:0 0 6px;"><strong>Account Number:</strong> ${escapeHtml(data.maskedAccount)}</p>
        ${data.accountName ? `<p style="margin:0 0 6px;"><strong>Account Name:</strong> ${escapeHtml(data.accountName)}</p>` : ''}
        <p style="margin:0;"><strong>Date & Time:</strong> ${escapeHtml(paidAt)}</p>
      </div>
      <p><strong>Next Step:</strong> Please check your bank account balance to confirm receipt of your ₦${data.amount.toLocaleString('en-NG')} payout.</p>
      <p>Thank you for promoting Zeek Softwares.</p>
    `;

    return this.sendBrandedEmail({
      to: data.affiliateEmail,
      recipientName: data.affiliateName,
      subject: `Affiliate Withdrawal Approved & Paid (₦${data.amount.toLocaleString('en-NG')}) — Zeek Softwares`,
      greeting: `Hello ${data.affiliateName},`,
      bodyHtml,
      ctaLabel: 'Open Affiliate Dashboard',
      ctaUrl: getPublicAppUrl(),
      isPromotional: false,
    });
  },

  async notifyAffiliateWithdrawalDeclined(data: {
    affiliateName: string;
    affiliateEmail: string;
    amount: number;
    reference: string;
    reason: string;
  }) {
    const bodyHtml = `
      <p>Your recent withdrawal request was declined by the administrator.</p>
      <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>Withdrawal Reference:</strong> ${escapeHtml(data.reference)}</p>
        <p style="margin:0 0 6px;"><strong>Amount:</strong> ₦${data.amount.toLocaleString('en-NG')}</p>
        <p style="margin:0;"><strong>Decline Reason:</strong> ${escapeHtml(data.reason)}</p>
      </div>
      <p>Your reserved balance of ₦${data.amount.toLocaleString('en-NG')} has been safely returned to your available affiliate wallet balance.</p>
    `;

    return this.sendBrandedEmail({
      to: data.affiliateEmail,
      recipientName: data.affiliateName,
      subject: `Update on Your Affiliate Withdrawal (${data.reference}) — Zeek Softwares`,
      greeting: `Hello ${data.affiliateName},`,
      bodyHtml,
      ctaLabel: 'Review Affiliate Wallet',
      ctaUrl: getPublicAppUrl(),
      isPromotional: false,
    });
  },

  async sendAffiliateVerificationEmail(data: {
    fullName: string;
    email: string;
    code: string;
    expiresInMinutes?: number;
  }) {
    const mins = data.expiresInMinutes || 20;
    const bodyHtml = `
      <p>Thank you for registering to become a <strong>Zeek Softwares Affiliate Partner</strong>.</p>
      <p>To confirm ownership of this email address and activate your affiliate account, enter the verification code below:</p>
      <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:12px;padding:18px;margin:16px 0;text-align:center;">
        <span style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748B;margin-bottom:8px;">
          Affiliate Email Verification Code
        </span>
        <span style="font-family:monospace;font-size:32px;font-weight:900;letter-spacing:0.2em;color:#061B45;">
          ${escapeHtml(data.code)}
        </span>
      </div>
      <p style="font-size:13px;color:#475569;">This code expires in <strong>${mins} minutes</strong>. Unverified accounts cannot access affiliate links, commissions, or withdrawals.</p>
    `;

    return this.sendBrandedEmail({
      to: data.email,
      recipientName: data.fullName,
      subject: `${data.code} — Verify Your Zeek Softwares Affiliate Account`,
      greeting: `Hello ${data.fullName},`,
      bodyHtml,
      isPromotional: false,
    });
  },

  async sendAffiliateActivatedEmail(data: {
    fullName: string;
    email: string;
    referralCode: string;
  }) {
    const appBase = getPublicAppUrl();
    const referralLink = `${appBase}/?ref=${encodeURIComponent(data.referralCode)}`;
    const bodyHtml = `
      <p>Your email address has been verified and your <strong>Zeek Softwares Affiliate Account</strong> is now active!</p>
      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:14px;margin:14px 0;">
        <p style="margin:0 0 6px;"><strong>Referral Code:</strong> ${escapeHtml(data.referralCode)}</p>
        <p style="margin:0;"><strong>Your Referral Link:</strong> <a href="${escapeHtml(
          referralLink
        )}" style="color:#061B45;font-weight:700;">${escapeHtml(referralLink)}</a></p>
      </div>
      <p>Sign in anytime to view your live wallet balance, commission breakdown, transaction history, and request withdrawals.</p>
    `;

    return this.sendBrandedEmail({
      to: data.email,
      recipientName: data.fullName,
      subject: 'Your Affiliate Account Is Verified & Active — Zeek Softwares',
      greeting: `Welcome aboard, ${data.fullName}!`,
      bodyHtml,
      ctaLabel: 'Open Affiliate Portal',
      ctaUrl: appBase,
      isPromotional: false,
    });
  },

  async sendPasswordResetEmail(data: {
    fullName: string;
    email: string;
    code: string;
    resetUrl: string;
    expiresInMinutes?: number;
  }) {
    const mins = data.expiresInMinutes || 15;
    const bodyHtml = `
      <p>We received a request to reset the password for your Zeek Softwares account.</p>
      <p>Use the one-time verification code below or click the button to create a new password:</p>
      <div style="background:#F8FAFC;border:1px solid #CBD5E1;border-radius:12px;padding:18px;margin:16px 0;text-align:center;">
        <span style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#64748B;margin-bottom:8px;">
          One-Time Password Reset Code
        </span>
        <span style="font-family:monospace;font-size:32px;font-weight:900;letter-spacing:0.2em;color:#061B45;">
          ${escapeHtml(data.code)}
        </span>
      </div>
      <p style="font-size:13px;color:#475569;">This reset code and link expire in <strong>${mins} minutes</strong> and can only be used once. If you did not request a password reset, you can safely ignore this email.</p>
    `;

    return this.sendBrandedEmail({
      to: data.email,
      recipientName: data.fullName,
      subject: `${data.code} — Reset Your Zeek Softwares Password`,
      greeting: `Hello ${data.fullName || 'there'},`,
      bodyHtml,
      ctaLabel: 'Reset Password Now',
      ctaUrl: data.resetUrl,
      isPromotional: false,
    });
  },

  async sendPasswordChangedEmail(data: { fullName: string; email: string }) {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const bodyHtml = `
      <p>Your Zeek Softwares account password has been changed successfully.</p>
      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:14px;margin:12px 0;">
        <p style="margin:0 0 6px;"><strong>Account:</strong> ${escapeHtml(data.email)}</p>
        <p style="margin:0;"><strong>Changed At:</strong> ${escapeHtml(now)} UTC</p>
      </div>
      <p>If you did not authorize this change, please contact support immediately.</p>
    `;

    return this.sendBrandedEmail({
      to: data.email,
      recipientName: data.fullName,
      subject: 'Password Changed Confirmation — Zeek Softwares',
      greeting: `Hello ${data.fullName || 'there'},`,
      bodyHtml,
      ctaLabel: 'Sign In to Account',
      ctaUrl: getPublicAppUrl(),
      isPromotional: false,
    });
  },

  async notifyCustomerOrderDelivery(data: {
    orderId: string;
    customerName: string;
    customerEmail: string;
    totalAmount: number;
    items: Array<{ productName: string; duration: string; quantity: number }>;
    deliveryUrl: string;
    whatsappUrl?: string;
    customUrl?: string;
    hasDownloads?: boolean;
  }) {
    const settings = await loadBrandingSettings();
    const subjectTpl =
      settings.emailBranding?.orderConfirmationSubject ||
      DEFAULT_EMAIL_BRANDING.orderConfirmationSubject ||
      'Order Confirmed — {{orderId}}';
    const subject = subjectTpl.replace(/\{\{\s*orderId\s*\}\}/gi, data.orderId);
    const intro =
      settings.emailBranding?.orderConfirmationIntro ||
      DEFAULT_EMAIL_BRANDING.orderConfirmationIntro ||
      'Thank you for your verified order with Zeek Softwares!';

    const itemsRows = data.items
      .map(
        (it) =>
          `<li style="margin:4px 0;"><strong>${escapeHtml(it.productName)}</strong> (${escapeHtml(
            it.duration
          )}) × ${it.quantity}</li>`
      )
      .join('');

    const bodyHtml = `
      <p>${escapeHtml(intro)}</p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin:14px 0;">
        <p style="margin:0 0 6px;"><strong>Order ID:</strong> ${escapeHtml(data.orderId)}</p>
        <p style="margin:0 0 8px;"><strong>Amount Paid:</strong> ₦${data.totalAmount.toLocaleString('en-NG')}</p>
        <ul style="margin:0;padding-left:18px;">${itemsRows}</ul>
      </div>
      <p>${
        data.hasDownloads
          ? 'Your purchased digital download(s) and delivery instructions are ready on your secure access page.'
          : 'Click the button below to access your confirmed order destination and activation instructions.'
      }</p>
    `;

    return this.sendBrandedEmail({
      to: data.customerEmail,
      recipientName: data.customerName,
      subject,
      greeting: `Hello ${data.customerName || 'there'},`,
      bodyHtml,
      ctaLabel: data.hasDownloads ? 'Access Your Downloads & Order' : 'Continue to Product Access',
      ctaUrl: data.deliveryUrl,
      isPromotional: false,
      settings,
    });
  },

  async buildPurchaseThankYouEmail(params: {
    orderId: string;
    customerName: string;
    customerEmail: string;
    totalAmount: number;
    items: Array<{ productName: string; duration: string; quantity: number }>;
    sendLogId?: string;
    brandingOverride?: Partial<EmailBrandingConfig>;
    communityOverride?: { whatsappCommunityUrl?: string; telegramChannelUrl?: string };
  }): Promise<{ subject: string; html: string; text: string; enabled: boolean }> {
    const baseSettings = await loadBrandingSettings();
    const mergedSettings: SiteSettings = {
      ...baseSettings,
      ...(params.communityOverride?.whatsappCommunityUrl !== undefined
        ? { whatsappCommunityUrl: params.communityOverride.whatsappCommunityUrl }
        : {}),
      ...(params.communityOverride?.telegramChannelUrl !== undefined
        ? { telegramChannelUrl: params.communityOverride.telegramChannelUrl }
        : {}),
      emailBranding: {
        ...DEFAULT_EMAIL_BRANDING,
        ...(baseSettings.emailBranding || {}),
        ...(params.brandingOverride || {}),
      },
    };

    const branding = mergedSettings.emailBranding!;
    const storeName = mergedSettings.storeName || 'Zeek Softwares';
    const cleanName = (params.customerName || '').trim();
    const firstName = cleanName ? cleanName.split(/\s+/)[0] : 'there';
    const formattedAmount = `₦${(params.totalAmount || 0).toLocaleString('en-NG')}`;

    const applyOrderVars = (tpl: string) =>
      String(tpl || '')
        .replace(/\{\{\s*orderId\s*\}\}/gi, params.orderId)
        .replace(/\{\{\s*storeName\s*\}\}/gi, storeName)
        .replace(/\{\{\s*amount\s*\}\}/gi, formattedAmount)
        .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
        .replace(/\{\{\s*(fullName|name|customerName)\s*\}\}/gi, cleanName || 'Valued Customer');

    const subjectTpl =
      branding.thankYouSubject?.trim() ||
      DEFAULT_EMAIL_BRANDING.thankYouSubject ||
      'Thank You for Purchasing With {{storeName}} ({{orderId}})';
    const greetingTpl =
      branding.thankYouGreeting?.trim() ||
      DEFAULT_EMAIL_BRANDING.thankYouGreeting ||
      'Thank you for your purchase, {{firstName}}!';
    const rawBody =
      branding.thankYouBodyHtml?.trim() ||
      DEFAULT_EMAIL_BRANDING.thankYouBodyHtml ||
      '<p>Thank you for choosing {{storeName}}!</p>';

    const whatsappUrl = (mergedSettings.whatsappCommunityUrl || '').trim();
    const telegramUrl = (mergedSettings.telegramChannelUrl || '').trim();
    const whatsappLabel =
      branding.thankYouWhatsappBtnLabel?.trim() || 'JOIN OUR WHATSAPP COMMUNITY';
    const telegramLabel =
      branding.thankYouTelegramBtnLabel?.trim() || 'JOIN OUR TELEGRAM COMMUNITY';

    const itemsRows = (params.items || [])
      .map(
        (it) =>
          `<li style="margin:4px 0;"><strong>${escapeHtml(it.productName)}</strong> (${escapeHtml(
            it.duration
          )}) &times; ${it.quantity}</li>`
      )
      .join('');

    const communityButtonsHtml =
      whatsappUrl || telegramUrl
        ? `<div style="margin:24px 0 8px;padding:18px;border-radius:12px;background-color:#F8FAFC;border:1px solid #E2E8F0;text-align:center;">
            <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#061B45;text-transform:uppercase;letter-spacing:0.04em;">
              Connect With Our Official Communities
            </p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
              ${
                whatsappUrl
                  ? `<tr>
                      <td align="center" style="padding:0 0 10px;">
                        <a href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 24px;border-radius:10px;background-color:#16A34A;color:#FFFFFF;font-size:13px;font-weight:800;text-decoration:none;letter-spacing:0.03em;">
                          ${escapeHtml(whatsappLabel)}
                        </a>
                      </td>
                    </tr>`
                  : ''
              }
              ${
                telegramUrl
                  ? `<tr>
                      <td align="center" style="padding:0;">
                        <a href="${escapeHtml(telegramUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 24px;border-radius:10px;background-color:#0284C7;color:#FFFFFF;font-size:13px;font-weight:800;text-decoration:none;letter-spacing:0.03em;">
                          ${escapeHtml(telegramLabel)}
                        </a>
                      </td>
                    </tr>`
                  : ''
              }
            </table>
          </div>`
        : '';

    const fullBodyHtml = `
      ${applyOrderVars(rawBody)}
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px;margin:16px 0;">
        <p style="margin:0 0 6px;font-size:13px;"><strong>Order Reference:</strong> ${escapeHtml(params.orderId)}</p>
        <p style="margin:0 0 8px;font-size:13px;"><strong>Total Paid:</strong> ${escapeHtml(formattedAmount)}</p>
        ${itemsRows ? `<ul style="margin:0;padding-left:18px;font-size:13px;">${itemsRows}</ul>` : ''}
      </div>
      ${communityButtonsHtml}
    `;

    const built = await buildBrandedEmailContent({
      recipientName: params.customerName,
      recipientEmail: params.customerEmail,
      subject: applyOrderVars(subjectTpl),
      greeting: applyOrderVars(greetingTpl),
      bodyHtml: fullBodyHtml,
      isPromotional: false,
      sendLogId: params.sendLogId,
      settings: mergedSettings,
    });

    const fallbackTextLinks = [
      whatsappUrl ? `${whatsappLabel}: ${whatsappUrl}` : '',
      telegramUrl ? `${telegramLabel}: ${telegramUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      subject: built.subject,
      html: built.html,
      text: fallbackTextLinks ? `${built.text}\n\n${fallbackTextLinks}` : built.text,
      enabled: branding.thankYouEnabled !== false,
    };
  },

  async notifyCustomerPurchaseThankYou(
    order: Order,
    options?: { retryLogId?: string; forceBypassSentFlag?: boolean }
  ): Promise<{
    sent: boolean;
    skipped?: boolean;
    reason?: string;
    log?: EmailSendLog;
    error?: string;
  }> {
    if (order.paymentStatus !== 'paid') {
      return { sent: false, skipped: true, reason: 'Order is not paid' };
    }

    const settings = await loadBrandingSettings();
    if (settings.emailBranding?.thankYouEnabled === false && !options?.forceBypassSentFlag) {
      return { sent: false, skipped: true, reason: 'Automatic thank-you email is disabled by Admin' };
    }

    const now = new Date().toISOString();

    // Atomic duplicate-prevention lock when triggered automatically
    if (!options?.forceBypassSentFlag) {
      const claimed = await OrderModel.findOneAndUpdate(
        {
          id: order.id,
          paymentStatus: 'paid',
          $or: [{ thankYouEmailSentAt: { $exists: false } }, { thankYouEmailSentAt: null }, { thankYouEmailSentAt: '' }],
        },
        { $set: { thankYouEmailSentAt: now } },
        { new: true }
      ).lean();

      if (!claimed) {
        return { sent: false, skipped: true, reason: 'Thank-you email already triggered for this order' };
      }
    }

    const existingLog = options?.retryLogId
      ? await EmailSendLogModel.findOne({ id: options.retryLogId }).lean()
      : await EmailSendLogModel.findOne({ orderId: order.id, sendType: 'thank_you' }).lean();

    const logId =
      existingLog?.id || `eml-ty-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const built = await this.buildPurchaseThankYouEmail({
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      totalAmount: order.totalAmount,
      items: order.items,
      sendLogId: logId,
    });

    if (!existingLog) {
      await EmailSendLogModel.create({
        id: logId,
        orderId: order.id,
        sendType: 'thank_you',
        recipientEmail: order.customerEmail.trim().toLowerCase(),
        recipientName: order.customerName,
        subject: built.subject,
        status: 'sending',
        attempts: 1,
        maxAttempts: 3,
        openCount: 0,
        clickCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await EmailSendLogModel.updateOne(
        { id: logId },
        {
          $inc: { attempts: 1 },
          $set: { status: 'sending', subject: built.subject, updatedAt: now },
        }
      );
    }

    const res = await this.sendEmail({
      to: order.customerEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });

    const completedAt = new Date().toISOString();
    const updatedLog = await EmailSendLogModel.findOneAndUpdate(
      { id: logId },
      {
        $set: {
          status: res.sent ? 'sent' : 'failed',
          provider: res.provider,
          messageId: res.messageId,
          error: res.sent ? undefined : res.error || 'Failed to dispatch thank-you email',
          sentAt: res.sent ? completedAt : undefined,
          updatedAt: completedAt,
        },
      },
      { new: true }
    ).lean();

    await auditService.addLog(
      res.sent ? 'Purchase Thank-You Email Sent' : 'Purchase Thank-You Email Failed',
      `Order ${order.id} -> ${order.customerEmail} | Status: ${res.sent ? 'Sent' : res.error || 'Failed'}`,
      options?.forceBypassSentFlag ? 'Admin Retry' : 'System Automation'
    );

    const cleanLog = updatedLog ? (({ _id, ...rest }) => rest as EmailSendLog)(updatedLog) : undefined;
    return {
      sent: res.sent,
      log: cleanLog,
      ...(res.error ? { error: res.error } : {}),
    };
  },

  async sendCustomerPaymentConfirmationEmail(params: {
    order: Order;
    transaction?: PaymentTransaction | null;
    deliveryUrl: string;
    hasDownloads?: boolean;
    digitalFileNames?: string[];
    fulfillmentInstructions?: string[];
  }): Promise<{ sent: boolean; skipped?: boolean; reason?: string; error?: string }> {
    const { order, transaction } = params;
    if (order.paymentStatus !== 'paid') {
      return { sent: false, skipped: true, reason: 'Order payment is not verified as paid' };
    }

    const now = new Date().toISOString();
    // Atomic idempotency claim so Paystack webhook retries / concurrent callbacks never double-send
    const claimed = await OrderModel.findOneAndUpdate(
      {
        id: order.id,
        paymentStatus: 'paid',
        paymentConfirmationEmailStatus: { $nin: ['sending', 'sent'] },
      },
      { $set: { paymentConfirmationEmailStatus: 'sending', updatedAt: now } },
      { new: true }
    ).lean();

    if (!claimed) {
      return {
        sent: false,
        skipped: true,
        reason: 'Customer payment confirmation email already sent or in progress',
      };
    }

    const settings = await loadBrandingSettings();
    const storeName = settings.storeName || 'Zeek Softwares';
    const txRef = transaction?.reference || order.paymentReference || order.id;
    const paidAmount = transaction?.amount || order.totalAmount;
    const currency = transaction?.currency || 'NGN';
    const formattedAmount =
      currency === 'NGN'
        ? `₦${Number(paidAmount || 0).toLocaleString('en-NG')}`
        : `${currency} ${Number(paidAmount || 0).toLocaleString('en-NG')}`;
    const paymentDateFormatted = formatEmailDateTime(
      transaction?.paidAt || order.verifiedAt || now
    );
    const channelLabel = transaction?.channel
      ? `${transaction.gateway || order.paymentMethod} (${transaction.channel})`
      : transaction?.gateway || order.paymentMethod || 'Paystack';

    const itemsRowsHtml = (order.items || [])
      .map((item) => {
        const lineTotal = (item.price || 0) * (item.quantity || 1);
        return `
          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #E2E8F0;font-size:13px;color:#0F172A;">
              <strong>${escapeHtml(item.productName)}</strong>
              <span style="display:block;font-size:12px;color:#64748B;">Plan: ${escapeHtml(
                item.duration
              )} &bull; Qty: ${item.quantity}</span>
            </td>
            <td align="right" style="padding:8px 0;border-bottom:1px solid #E2E8F0;font-size:13px;font-weight:700;color:#061B45;white-space:nowrap;">
              ₦${lineTotal.toLocaleString('en-NG')}
            </td>
          </tr>`;
      })
      .join('');

    const activationBlocks: string[] = [];
    if (order.activationCredentials?.trim()) {
      activationBlocks.push(`
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px;margin:12px 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#1D4ED8;">
            Activation &amp; Access Credentials
          </p>
          <div style="font-size:13px;color:#0F172A;white-space:pre-wrap;font-family:monospace;">${escapeHtml(
            order.activationCredentials.trim()
          )}</div>
        </div>
      `);
    }

    if (params.digitalFileNames && params.digitalFileNames.length > 0) {
      activationBlocks.push(`
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px;margin:12px 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#15803D;">
            Ready Digital Downloads
          </p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#0F172A;">
            ${params.digitalFileNames.map((fn) => `<li>${escapeHtml(fn)}</li>`).join('')}
          </ul>
        </div>
      `);
    }

    const cleanInstructions = (params.fulfillmentInstructions || [])
      .map((s) => s.trim())
      .filter(Boolean);
    if (cleanInstructions.length > 0) {
      activationBlocks.push(`
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;margin:12px 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#334155;">
            Product Activation &amp; Fulfillment Instructions
          </p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#334155;">
            ${cleanInstructions.map((inst) => `<li style="margin:3px 0;">${escapeHtml(inst)}</li>`).join('')}
          </ul>
        </div>
      `);
    }

    const bodyHtml = `
      <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ECFDF5;border:1px solid #A7F3D0;color:#047857;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin:0 0 14px;">
        Payment Successful &bull; Verified
      </div>
      <p style="margin:0 0 12px;">
        Thank you for shopping with <strong>${escapeHtml(storeName)}</strong>! Your Paystack payment has been verified and your order has been received.
      </p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:14px 0;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#475569;">
          Payment &amp; Order Summary
        </p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Customer Name:</strong> ${escapeHtml(
          order.customerName
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Order ID:</strong> ${escapeHtml(
          order.id
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Transaction Reference:</strong> <span style="font-family:monospace;">${escapeHtml(
          txRef
        )}</span></p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Amount Paid:</strong> <strong style="color:#061B45;">${escapeHtml(
          formattedAmount
        )}</strong></p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Payment Method:</strong> ${escapeHtml(
          channelLabel
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Payment Status:</strong> Payment Successful (Verified)</p>
        <p style="margin:0;font-size:13px;"><strong>Payment Date &amp; Time:</strong> ${escapeHtml(
          paymentDateFormatted
        )}</p>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:14px 0;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#475569;">
          Purchased Product(s)
        </p>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          ${itemsRowsHtml}
        </table>
      </div>
      ${activationBlocks.join('')}
      <p style="margin:14px 0 0;font-size:13px;color:#334155;">
        Use the secure button below anytime to access your order details, digital downloads, or activation portal:
      </p>
    `;

    const subject = `Payment Successful — Order Confirmed (${order.id}) | ${storeName}`;
    const logId = `eml-pay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const built = await buildBrandedEmailContent({
      recipientName: order.customerName,
      recipientEmail: order.customerEmail,
      subject,
      greeting: `Hello ${order.customerName || 'Valued Customer'},`,
      bodyHtml,
      ctaLabel: params.hasDownloads ? 'Access Downloads & Order Details' : 'Access Your Order & Activation',
      ctaUrl: params.deliveryUrl,
      preheader: `Payment of ${formattedAmount} verified for order ${order.id} (Ref: ${txRef}).`,
      isPromotional: false,
      sendLogId: logId,
      settings,
    });

    await EmailSendLogModel.create({
      id: logId,
      orderId: order.id,
      sendType: 'transactional',
      recipientEmail: order.customerEmail.trim().toLowerCase(),
      recipientName: order.customerName,
      subject: built.subject,
      status: 'sending',
      attempts: 1,
      maxAttempts: 3,
      openCount: 0,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const res = await this.sendEmail({
      to: order.customerEmail,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });

    const completedAt = new Date().toISOString();
    await Promise.all([
      OrderModel.updateOne(
        { id: order.id },
        {
          $set: {
            paymentConfirmationEmailStatus: res.sent ? 'sent' : 'failed',
            ...(res.sent ? { paymentConfirmationEmailSentAt: completedAt } : {}),
            updatedAt: completedAt,
          },
        }
      ),
      EmailSendLogModel.updateOne(
        { id: logId },
        {
          $set: {
            status: res.sent ? 'sent' : 'failed',
            provider: res.provider,
            messageId: res.messageId,
            error: res.sent ? undefined : res.error || 'Failed to dispatch payment confirmation email',
            sentAt: res.sent ? completedAt : undefined,
            updatedAt: completedAt,
          },
        }
      ),
      auditService.addLog(
        res.sent ? 'Customer Payment Confirmation Email Sent' : 'Customer Payment Confirmation Email Failed',
        `Order ${order.id} (Ref: ${txRef}) -> ${order.customerEmail} | Status: ${
          res.sent ? 'Sent' : res.error || 'Failed'
        }`,
        'Paystack Automation'
      ),
    ]);

    return {
      sent: res.sent,
      ...(res.error ? { error: res.error } : {}),
    };
  },

  async sendAffiliatePurchaseNotificationEmail(params: {
    affiliate: Affiliate;
    order: Order;
    transaction?: PaymentTransaction | null;
    commission: AffiliateCommission;
  }): Promise<{ sent: boolean; skipped?: boolean; reason?: string; error?: string }> {
    const { affiliate, order, transaction, commission } = params;

    if (order.paymentStatus !== 'paid') {
      return { sent: false, skipped: true, reason: 'Order is not paid' };
    }
    if (!affiliate || affiliate.status !== 'active' || !affiliate.email) {
      return { sent: false, skipped: true, reason: 'Affiliate account is missing or inactive' };
    }
    if (!order.affiliateId || String(order.affiliateId) !== String(affiliate._id)) {
      return { sent: false, skipped: true, reason: 'Order is not attributed to this affiliate' };
    }
    if (order.customerEmail.trim().toLowerCase() === affiliate.email.trim().toLowerCase()) {
      return { sent: false, skipped: true, reason: 'Self-referral notification blocked' };
    }
    if (!commission || commission.commissionAmount <= 0 || commission.status === 'reversed') {
      return { sent: false, skipped: true, reason: 'No active commission recorded for this order' };
    }

    const now = new Date().toISOString();
    // Atomic idempotency claim so Paystack webhook retries / concurrent callbacks never double-notify affiliate
    const claimed = await OrderModel.findOneAndUpdate(
      {
        id: order.id,
        paymentStatus: 'paid',
        affiliateId: affiliate._id,
        affiliateNotificationEmailStatus: { $nin: ['sending', 'sent'] },
      },
      { $set: { affiliateNotificationEmailStatus: 'sending', updatedAt: now } },
      { new: true }
    ).lean();

    if (!claimed) {
      return {
        sent: false,
        skipped: true,
        reason: 'Affiliate purchase notification already sent or in progress',
      };
    }

    const settings = await loadBrandingSettings();
    const storeName = settings.storeName || 'Zeek Softwares';
    const appBase = getPublicAppUrl();
    const txRef = transaction?.reference || order.paymentReference || order.id;
    const purchaseDateFormatted = formatEmailDateTime(
      transaction?.paidAt || order.verifiedAt || commission.createdAt || now
    );
    const commissionStatusLabel =
      commission.status === 'eligible'
        ? 'Approved (Credited to Wallet)'
        : commission.status === 'pending'
        ? 'Pending'
        : 'Reversed';

    // Privacy check: list purchased product names/durations ONLY — zero customer PII
    const productSummaryText =
      (order.items || [])
        .map((it) => `${it.productName} (${it.duration}) × ${it.quantity}`)
        .join(', ') || commission.productName;

    const formattedPurchaseAmount = `₦${Number(order.totalAmount || 0).toLocaleString('en-NG')}`;
    const formattedCommission = `₦${Number(commission.commissionAmount || 0).toLocaleString('en-NG')}`;

    const bodyHtml = `
      <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#ECFDF5;border:1px solid #A7F3D0;color:#047857;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;margin:0 0 14px;">
        New Verified Referral Sale
      </div>
      <p style="margin:0 0 12px;">
        Great news! A customer has successfully completed a verified purchase through your <strong>${escapeHtml(
          storeName
        )} Affiliate Referral Link</strong>.
      </p>
      <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:16px;margin:14px 0;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#047857;">
          Commission Earned
        </p>
        <p style="margin:0;font-size:26px;font-weight:900;color:#065F46;">
          ${escapeHtml(formattedCommission)}
          <span style="font-size:13px;font-weight:700;color:#047857;">(${commission.commissionRate}% rate)</span>
        </p>
      </div>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:12px;padding:16px;margin:14px 0;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:#475569;">
          Referral Transaction Details
        </p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Affiliate Name:</strong> ${escapeHtml(
          affiliate.fullName
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Product Purchased:</strong> ${escapeHtml(
          productSummaryText
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Order Reference:</strong> ${escapeHtml(
          order.id
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Transaction Reference:</strong> <span style="font-family:monospace;">${escapeHtml(
          txRef
        )}</span></p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Purchase Amount:</strong> ${escapeHtml(
          formattedPurchaseAmount
        )}</p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Commission Earned:</strong> <strong style="color:#047857;">${escapeHtml(
          formattedCommission
        )}</strong></p>
        <p style="margin:0 0 6px;font-size:13px;"><strong>Commission Status:</strong> ${escapeHtml(
          commissionStatusLabel
        )}</p>
        <p style="margin:0;font-size:13px;"><strong>Purchase Date &amp; Time:</strong> ${escapeHtml(
          purchaseDateFormatted
        )}</p>
      </div>
      <p style="margin:12px 0 0;font-size:13px;color:#475569;">
        This commission has been automatically recorded in your affiliate earnings and transaction history. Open your Affiliate Dashboard anytime to track your live wallet balance and request payouts.
      </p>
    `;

    const subject = `New Affiliate Sale: You Earned ${formattedCommission} (${order.id}) | ${storeName}`;
    const logId = `eml-aff-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const built = await buildBrandedEmailContent({
      recipientName: affiliate.fullName,
      recipientEmail: affiliate.email,
      subject,
      greeting: `Congratulations, ${affiliate.fullName}!`,
      bodyHtml,
      ctaLabel: 'Open Affiliate Dashboard',
      ctaUrl: appBase,
      preheader: `You earned ${formattedCommission} commission from a verified referral purchase (${order.id}).`,
      isPromotional: false,
      sendLogId: logId,
      settings,
    });

    await EmailSendLogModel.create({
      id: logId,
      orderId: order.id,
      sendType: 'transactional',
      recipientEmail: affiliate.email.trim().toLowerCase(),
      recipientName: affiliate.fullName,
      subject: built.subject,
      status: 'sending',
      attempts: 1,
      maxAttempts: 3,
      openCount: 0,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    const res = await this.sendEmail({
      to: affiliate.email,
      subject: built.subject,
      text: built.text,
      html: built.html,
    });

    const completedAt = new Date().toISOString();
    await Promise.all([
      OrderModel.updateOne(
        { id: order.id },
        {
          $set: {
            affiliateNotificationEmailStatus: res.sent ? 'sent' : 'failed',
            ...(res.sent ? { affiliateNotificationEmailSentAt: completedAt } : {}),
            updatedAt: completedAt,
          },
        }
      ),
      EmailSendLogModel.updateOne(
        { id: logId },
        {
          $set: {
            status: res.sent ? 'sent' : 'failed',
            provider: res.provider,
            messageId: res.messageId,
            error: res.sent ? undefined : res.error || 'Failed to dispatch affiliate purchase notification',
            sentAt: res.sent ? completedAt : undefined,
            updatedAt: completedAt,
          },
        }
      ),
      auditService.addLog(
        res.sent
          ? 'Affiliate Purchase Notification Email Sent'
          : 'Affiliate Purchase Notification Email Failed',
        `Order ${order.id} -> Affiliate ${affiliate.fullName} (${affiliate.email}) | Commission: ${formattedCommission} | Status: ${
          res.sent ? 'Sent' : res.error || 'Failed'
        }`,
        'Paystack Automation'
      ),
    ]);

    return {
      sent: res.sent,
      ...(res.error ? { error: res.error } : {}),
    };
  },
};
