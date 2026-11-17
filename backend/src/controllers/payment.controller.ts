import crypto from 'crypto';
import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { env } from '../config/env';
import { paystackService } from '../services';

const resolveSafeAppBaseUrl = (req: Request): string => {
  if (env.appUrl && !env.appUrl.includes('MY_APP_URL')) {
    try {
      const parsed = new URL(env.appUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return env.appUrl.replace(/\/$/, '');
      }
    } catch {
      // Fall through to host validation
    }
  }

  const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const safeHost = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(rawHost) ? rawHost : 'localhost:3000';
  const protocol =
    req.protocol === 'https' || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
      ? 'https'
      : 'http';
  return `${protocol}://${safeHost}`;
};

export const paymentController = {
  initializePaystack: asyncHandler(async (req: Request, res: Response) => {
    const { orderId } = req.body;
    const appBaseUrl = resolveSafeAppBaseUrl(req);
    const callbackUrl = `${appBaseUrl}/payment-verify?orderId=${encodeURIComponent(orderId)}`;
    const result = await paystackService.initializeTransaction(orderId, callbackUrl);
    res.json(result);
  }),

  verifyPaystack: asyncHandler(async (req: Request, res: Response) => {
    const result = await paystackService.verifyTransaction(req.params.reference);
    res.json(result);
  }),

  getPaymentHistory: asyncHandler(async (req: Request, res: Response) => {
    const query = String(req.body?.query || req.query?.query || '');
    const transactions = await paystackService.lookupPaymentHistory(query);
    res.json({
      success: true,
      transactions,
    });
  }),

  handlePaystackWebhook: asyncHandler(async (req: Request, res: Response) => {
    if (!paystackService.isKeyConfigured()) {
      res.status(503).send('Paystack gateway not configured');
      return;
    }

    const signature = (req.headers['x-paystack-signature'] as string) || '';
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf-8')
      : JSON.stringify(req.body || {});

    const expectedHash = crypto
      .createHmac('sha512', env.paystackSecretKey)
      .update(rawBody, 'utf8')
      .digest('hex');

    if (
      !signature ||
      !paystackService.verifyWebhookSignature(rawBody, signature) ||
      expectedHash.length !== signature.trim().length
    ) {
      res.status(401).send('Invalid signature');
      return;
    }

    let event: {
      event?: string;
      data?: {
        reference?: string;
        amount?: number;
        currency?: string;
        channel?: string;
        gateway_response?: string;
        paid_at?: string;
        status?: string;
        metadata?: Record<string, unknown>;
      };
    };

    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).send('Invalid webhook JSON');
      return;
    }

    if (event?.event === 'charge.success' && event?.data?.reference) {
      await paystackService.processWebhookChargeSuccess(event.data);
    }

    res.status(200).send('Webhook processed');
  }),
};
