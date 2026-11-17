import crypto from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { escapeRegExp, safeTimingEqual } from '../utils/security';
import {
  Affiliate,
  AffiliateCommission,
  Order,
  PaymentTransaction,
  Product,
} from '../types';
import {
  AffiliateCommissionModel,
  OrderModel,
  PaymentTransactionModel,
  ProductDeliveryRecordModel,
  ProductModel,
} from '../models';
import { orderService } from './order.service';
import { requireDatabaseConnection } from '../config/database';
import { auditService } from './audit.service';
import { deliveryService } from './delivery.service';
import { affiliateService } from './affiliate.service';
import { emailService, getPublicAppUrl } from './email.service';

interface PaystackInitResponse {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data?: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    channel: string;
    gateway_response?: string;
    paid_at: string;
    customer?: { email: string };
    metadata?: Record<string, unknown>;
  };
}

export const paystackService = {
  isKeyConfigured(): boolean {
    const key = env.paystackSecretKey;
    return Boolean(
      key &&
        !key.includes('your_secret_key_here') &&
        (key.startsWith('sk_test_') || key.startsWith('sk_live_'))
    );
  },

  isSimulationAllowed(): boolean {
    if (this.isKeyConfigured()) return false;
    if (env.isProduction || env.paystackMode === 'live') return false;
    return true;
  },

  async registerVerifiedTransaction(params: {
    reference: string;
    order: Order;
    amount: number;
    currency?: string;
    gateway?: string;
    channel?: string;
    status?: PaymentTransaction['status'];
    paidAt?: string;
    verifiedVia: PaymentTransaction['verifiedVia'];
    gatewayResponse?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentTransaction> {
    requireDatabaseConnection();
    const now = new Date().toISOString();
    const cleanRef = params.reference.trim();
    const paidAt = params.paidAt || params.order.verifiedAt || now;
    const doc = await PaymentTransactionModel.findOneAndUpdate(
      { reference: cleanRef },
      {
        $setOnInsert: {
          id: `TX-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
          reference: cleanRef,
          orderId: params.order.id,
          customerName: params.order.customerName,
          customerEmail: params.order.customerEmail.trim().toLowerCase(),
          amount: params.amount,
          currency: (params.currency || 'NGN').toUpperCase(),
          gateway: params.gateway || params.order.paymentMethod || 'Paystack',
          paidAt,
          verifiedVia: params.verifiedVia,
          createdAt: now,
        },
        $set: {
          status: params.status || 'success',
          ...(params.channel ? { channel: params.channel } : {}),
          ...(params.gatewayResponse ? { gatewayResponse: params.gatewayResponse } : {}),
          ...(params.metadata ? { metadata: params.metadata } : {}),
          updatedAt: now,
        },
      },
      { upsert: true, new: true }
    ).lean();

    const { _id, ...rest } = doc!;
    return rest as PaymentTransaction;
  },

  async dispatchVerifiedNotifications(
    order: Order,
    transaction: PaymentTransaction,
    commissionContext?: { affiliate?: Affiliate; commission?: AffiliateCommission }
  ): Promise<void> {
    if (order.paymentStatus !== 'paid') return;

    try {
      const deliveryRecords = await deliveryService.syncDeliveryRecordsForOrder(order);
      const appBase = getPublicAppUrl();
      const firstToken = deliveryRecords[0]?.downloadToken || '';
      const deliveryUrl = `${appBase}/delivery/${encodeURIComponent(order.id)}${
        firstToken ? `?token=${encodeURIComponent(firstToken)}` : ''
      }`;
      const hasDownloads = deliveryRecords.some((r) => r.destinationType === 'digital_download');
      const digitalFileNames = deliveryRecords
        .map((r) => r.digitalFileName)
        .filter((name): name is string => Boolean(name && name.trim()));

      const productIds = Array.from(new Set((order.items || []).map((i) => i.productId).filter(Boolean)));
      const productDocs = productIds.length
        ? await ProductModel.find({ id: { $in: productIds } }).lean()
        : [];
      const fulfillmentInstructions = (productDocs as Product[])
        .map((p) => p.fulfillmentInstructions)
        .filter((inst): inst is string => Boolean(inst && inst.trim()));

      const customerMailRes = await emailService
        .sendCustomerPaymentConfirmationEmail({
          order,
          transaction,
          deliveryUrl,
          hasDownloads,
          digitalFileNames,
          fulfillmentInstructions,
        })
        .catch((err) => {
          console.error('[PaystackService] Customer payment confirmation email failed:', err);
          return { sent: false };
        });

      if (customerMailRes.sent) {
        await ProductDeliveryRecordModel.updateMany(
          { orderId: order.id, deliveryStatus: 'link_generated' },
          { $set: { deliveryStatus: 'delivered', updatedAt: new Date().toISOString() } }
        ).catch(() => {});
      }
    } catch (err) {
      console.error('[PaystackService] Failed dispatching customer confirmation email:', err);
    }

    // Only notify affiliate when purchase is genuinely attributed to an active affiliate and commission is recorded
    if (order.affiliateId) {
      try {
        let commission = commissionContext?.commission;
        let affiliate = commissionContext?.affiliate;

        if (!commission) {
          const commDoc = await AffiliateCommissionModel.findOne({ orderId: order.id }).lean();
          if (commDoc) {
            const { _id, ...rest } = commDoc;
            commission = rest as AffiliateCommission;
          }
        }
        if (!affiliate && order.affiliateId) {
          affiliate = (await affiliateService.getAffiliateById(order.affiliateId)) || undefined;
        }

        if (
          affiliate &&
          affiliate.status === 'active' &&
          commission &&
          commission.commissionAmount > 0 &&
          commission.status !== 'reversed'
        ) {
          await emailService
            .sendAffiliatePurchaseNotificationEmail({
              affiliate,
              order,
              transaction,
              commission,
            })
            .catch((err) => {
              console.error('[PaystackService] Affiliate purchase notification email failed:', err);
            });
        }
      } catch (err) {
        console.error('[PaystackService] Failed dispatching affiliate notification email:', err);
      }
    }
  },

  async finalizePaidOrder(
    order: Order,
    params: {
      reference: string;
      amountPaidNgn: number;
      currency?: string;
      channel?: string;
      paidAt: string;
      verifiedVia: PaymentTransaction['verifiedVia'];
      verifiedByLabel: string;
      gatewayResponse?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<{ order: Order; transaction: PaymentTransaction; alreadyProcessed: boolean }> {
    requireDatabaseConnection();

    // Register verified transaction in database atomically & idempotently
    const transaction = await this.registerVerifiedTransaction({
      reference: params.reference,
      order,
      amount: params.amountPaidNgn,
      currency: params.currency || 'NGN',
      gateway: 'Paystack',
      channel: params.channel,
      status: 'success',
      paidAt: params.paidAt,
      verifiedVia: params.verifiedVia,
      gatewayResponse: params.gatewayResponse,
      metadata: params.metadata,
    });

    const latestBeforeUpdate = (await orderService.getOrderById(order.id)) || order;
    const alreadyProcessed = latestBeforeUpdate.paymentStatus === 'paid';

    let workingOrder = latestBeforeUpdate;
    if (!alreadyProcessed) {
      const updatedOrder = await orderService.updateOrder(
        latestBeforeUpdate.id,
        {
          paymentStatus: 'paid',
          fulfillmentStatus: 'Payment Confirmed',
          paymentReference: params.reference,
          verifiedAt: params.paidAt,
          verifiedBy: params.verifiedByLabel,
        },
        params.verifiedByLabel,
        { skipDeliveryEmail: true, skipCommission: true }
      );
      if (updatedOrder) {
        workingOrder = updatedOrder;
      }
    }

    // Atomically award affiliate commission (if referred & active & non-self-referred)
    const commResult = await affiliateService.awardAffiliateCommission(workingOrder);
    const refreshedOrder = (await orderService.getOrderById(workingOrder.id)) || workingOrder;

    // Dispatch customer payment confirmation & affiliate purchase notification (strictly idempotent)
    await this.dispatchVerifiedNotifications(refreshedOrder, transaction, {
      affiliate: commResult.affiliate,
      commission: commResult.commission,
    });

    const finalOrder = (await orderService.getOrderById(workingOrder.id)) || refreshedOrder;
    return {
      order: finalOrder,
      transaction,
      alreadyProcessed,
    };
  },

  async initializeTransaction(orderId: string, callbackUrl: string) {
    const order = await orderService.getOrderById(orderId);
    if (!order) {
      throw new ApiError(404, `Order ${orderId} not found`);
    }
    if (order.paymentStatus === 'paid') {
      throw new ApiError(400, `Order ${orderId} is already paid and verified.`);
    }

    const amountInKobo = Math.round(order.totalAmount * 100);
    if (amountInKobo <= 0) {
      throw new ApiError(400, 'Order amount must be greater than zero.');
    }

    const reference = `${orderId}_${Date.now()}`;

    await orderService.updateOrder(orderId, {
      paymentReference: reference,
      paymentMethod: 'Paystack',
    });

    if (this.isKeyConfigured()) {
      const response = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.paystackSecretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: order.customerEmail,
          amount: amountInKobo,
          reference,
          callback_url: callbackUrl,
          metadata: {
            orderId: order.id,
            customerName: order.customerName,
            customerWhatsApp: order.customerWhatsApp,
            items: order.items.map((i) => `${i.productName} (${i.duration})`).join(', '),
          },
        }),
      });

      const data = (await response.json()) as PaystackInitResponse;
      if (!data.status || !data.data) {
        throw new ApiError(502, data.message || 'Failed to initialize Paystack transaction');
      }

      return {
        status: true,
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
        mode: env.paystackSecretKey.startsWith('sk_live_') ? 'live' : 'test',
      };
    }

    if (!this.isSimulationAllowed()) {
      throw new ApiError(
        503,
        'Paystack payment gateway is not configured on the server. Please configure PAYSTACK_SECRET_KEY or choose another payment method.'
      );
    }

    return {
      status: true,
      authorizationUrl: `/paystack-test-checkout?reference=${encodeURIComponent(
        reference
      )}&amount=${order.totalAmount}&orderId=${encodeURIComponent(order.id)}`,
      accessCode: `TEST_CODE_${Date.now()}`,
      reference,
      mode: 'test_simulation',
      note: 'Development Paystack sandbox active. Configure PAYSTACK_SECRET_KEY for live verification.',
    };
  },

  async verifyTransaction(reference: string) {
    let order = await orderService.getOrderById(reference);
    if (!order && reference.includes('_')) {
      order = await orderService.getOrderById(reference.split('_')[0]);
    }
    if (!order) {
      throw new ApiError(404, `No order associated with transaction reference: ${reference}`);
    }

    if (order.paymentStatus === 'paid') {
      const txRef = order.paymentReference || reference;
      const existingTx = await PaymentTransactionModel.findOne({
        $or: [{ reference: txRef }, { orderId: order.id }],
      }).lean();
      const transaction = existingTx
        ? (({ _id, ...rest }) => rest as PaymentTransaction)(existingTx)
        : await this.registerVerifiedTransaction({
            reference: txRef,
            order,
            amount: order.totalAmount,
            currency: 'NGN',
            gateway: order.paymentMethod || 'Paystack',
            status: 'success',
            paidAt: order.verifiedAt || order.updatedAt,
            verifiedVia: 'callback',
          });

      // Ensure commission & notifications complete cleanly even if webhook crashed mid-flight earlier
      if (order.paymentMethod === 'Paystack') {
        const commResult = await affiliateService.awardAffiliateCommission(order);
        const refreshedOrder = (await orderService.getOrderById(order.id)) || order;
        if (
          !refreshedOrder.paymentConfirmationEmailStatus ||
          refreshedOrder.paymentConfirmationEmailStatus === 'failed' ||
          (refreshedOrder.affiliateId &&
            (!refreshedOrder.affiliateNotificationEmailStatus ||
              refreshedOrder.affiliateNotificationEmailStatus === 'failed'))
        ) {
          await this.dispatchVerifiedNotifications(refreshedOrder, transaction, {
            affiliate: commResult.affiliate,
            commission: commResult.commission,
          });
        }
      }

      const finalOrder = (await orderService.getOrderById(order.id)) || order;
      return {
        status: true,
        alreadyProcessed: true,
        order: finalOrder,
        transaction,
        channel: transaction.channel,
        verifiedAt: transaction.paidAt,
        message: 'Order payment is already verified and confirmed.',
      };
    }

    if (this.isKeyConfigured()) {
      const response = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.paystackSecretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = (await response.json()) as PaystackVerifyResponse;
      if (!data.status || !data.data) {
        throw new ApiError(400, data.message || 'Transaction verification failed');
      }

      const tx = data.data;
      if (tx.status !== 'success') {
        return {
          status: false,
          paymentStatus: tx.status,
          message: `Payment status is ${tx.status}`,
        };
      }

      if (tx.reference && tx.reference !== reference) {
        throw new ApiError(400, 'Verified transaction reference mismatch.');
      }

      if (tx.currency && tx.currency.toUpperCase() !== 'NGN') {
        throw new ApiError(400, `Unexpected transaction currency: ${tx.currency}`);
      }

      const expectedKobo = Math.round(order.totalAmount * 100);
      if (typeof tx.amount !== 'number' || tx.amount < expectedKobo) {
        throw new ApiError(
          400,
          `Paid amount (${Number(tx.amount || 0) / 100} NGN) is less than required (${order.totalAmount} NGN)`
        );
      }

      const paidAt = tx.paid_at || new Date().toISOString();
      const result = await this.finalizePaidOrder(order, {
        reference,
        amountPaidNgn: Math.round(tx.amount / 100),
        currency: tx.currency || 'NGN',
        channel: tx.channel,
        paidAt,
        verifiedVia: 'callback',
        verifiedByLabel: 'Paystack Automated Verification',
        gatewayResponse: tx.gateway_response,
        metadata: tx.metadata,
      });

      return {
        status: true,
        alreadyProcessed: result.alreadyProcessed,
        order: result.order,
        transaction: result.transaction,
        channel: tx.channel,
        verifiedAt: paidAt,
        message: 'Payment verified automatically and transaction registered.',
      };
    }

    if (!this.isSimulationAllowed()) {
      throw new ApiError(
        503,
        'Paystack payment verification is unavailable because PAYSTACK_SECRET_KEY is not configured.'
      );
    }

    // Even in non-production simulation, require an initialized Paystack session reference
    if (order.paymentMethod !== 'Paystack' || order.paymentReference !== reference) {
      throw new ApiError(
        400,
        'Invalid simulated Paystack reference. Please initialize Paystack checkout first.'
      );
    }

    const paidAt = new Date().toISOString();
    const result = await this.finalizePaidOrder(order, {
      reference,
      amountPaidNgn: order.totalAmount,
      currency: 'NGN',
      channel: 'test_card',
      paidAt,
      verifiedVia: 'simulation',
      verifiedByLabel: 'Paystack Test Simulation',
      gatewayResponse: 'Approved (Sandbox)',
    });

    return {
      status: true,
      alreadyProcessed: result.alreadyProcessed,
      order: result.order,
      transaction: result.transaction,
      channel: 'test_card',
      verifiedAt: paidAt,
      message: 'Payment verified automatically in sandbox.',
    };
  },

  async processWebhookChargeSuccess(eventData: {
    reference?: string;
    amount?: number;
    currency?: string;
    channel?: string;
    gateway_response?: string;
    paid_at?: string;
    status?: string;
    metadata?: Record<string, unknown>;
  }) {
    requireDatabaseConnection();
    const reference = String(eventData.reference || '').trim();
    if (!reference) {
      throw new ApiError(400, 'Missing transaction reference in Paystack webhook payload.');
    }

    const metadataOrderId =
      eventData.metadata && typeof eventData.metadata.orderId === 'string'
        ? eventData.metadata.orderId
        : undefined;

    let order = await orderService.getOrderById(reference);
    if (!order && metadataOrderId) {
      order = await orderService.getOrderById(metadataOrderId);
    }
    if (!order && reference.includes('_')) {
      order = await orderService.getOrderById(reference.split('_')[0]);
    }
    if (!order) {
      await auditService.addLog(
        'Paystack Webhook Ignored',
        `No matching order found for webhook reference ${reference}`,
        'Paystack Webhook'
      );
      return { processed: false, reason: 'Order not found for reference' };
    }

    // Server-to-server cross-verify with Paystack Verify API for maximum integrity
    let verifiedAmountKobo = typeof eventData.amount === 'number' ? eventData.amount : Math.round(order.totalAmount * 100);
    let verifiedCurrency = eventData.currency || 'NGN';
    let verifiedChannel = eventData.channel;
    let verifiedPaidAt = eventData.paid_at || new Date().toISOString();
    let verifiedGatewayResponse = eventData.gateway_response;

    if (this.isKeyConfigured()) {
      try {
        const verifyRes = await fetch(
          `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${env.paystackSecretKey}`,
              'Content-Type': 'application/json',
            },
          }
        );
        const verifyJson = (await verifyRes.json()) as PaystackVerifyResponse;
        if (verifyJson.status && verifyJson.data) {
          if (verifyJson.data.status !== 'success') {
            throw new ApiError(
              400,
              `Paystack verify returned status "${verifyJson.data.status}" for ${reference}`
            );
          }
          verifiedAmountKobo = verifyJson.data.amount;
          verifiedCurrency = verifyJson.data.currency || verifiedCurrency;
          verifiedChannel = verifyJson.data.channel || verifiedChannel;
          verifiedPaidAt = verifyJson.data.paid_at || verifiedPaidAt;
          verifiedGatewayResponse = verifyJson.data.gateway_response || verifiedGatewayResponse;
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // If remote Paystack verify temporarily times out, webhook HMAC signature + payload amount check still holds
      }
    }

    const expectedKobo = Math.round(order.totalAmount * 100);
    if (verifiedCurrency && verifiedCurrency.toUpperCase() !== 'NGN') {
      throw new ApiError(400, 'Webhook currency mismatch');
    }
    if (typeof verifiedAmountKobo !== 'number' || verifiedAmountKobo < expectedKobo) {
      throw new ApiError(400, 'Webhook amount mismatch');
    }

    const result = await this.finalizePaidOrder(order, {
      reference,
      amountPaidNgn: Math.round(verifiedAmountKobo / 100),
      currency: verifiedCurrency,
      channel: verifiedChannel,
      paidAt: verifiedPaidAt,
      verifiedVia: 'webhook',
      verifiedByLabel: 'Paystack Webhook',
      gatewayResponse: verifiedGatewayResponse,
      metadata: eventData.metadata,
    });

    await auditService.addLog(
      'Paystack Webhook Verified',
      `Webhook confirmed payment for order ${order.id} (Ref: ${reference}, Amount: ₦${Math.round(
        verifiedAmountKobo / 100
      ).toLocaleString('en-NG')})`,
      'Paystack Webhook'
    );

    return {
      processed: true,
      alreadyProcessed: result.alreadyProcessed,
      order: result.order,
      transaction: result.transaction,
    };
  },

  async getTransactionForOrderOrRef(orderIdOrRef: string): Promise<PaymentTransaction | null> {
    requireDatabaseConnection();
    const doc = await PaymentTransactionModel.findOne({
      $or: [{ orderId: orderIdOrRef }, { reference: orderIdOrRef }],
    })
      .sort({ paidAt: -1 })
      .lean();
    if (!doc) return null;
    const { _id, ...rest } = doc;
    return rest as PaymentTransaction;
  },

  async lookupPaymentHistory(query: string): Promise<PaymentTransaction[]> {
    requireDatabaseConnection();
    const q = query.trim().toLowerCase();
    if (!q || q.length < 4) return [];
    const escaped = escapeRegExp(q);
    const docs = await PaymentTransactionModel.find({
      $or: [
        { orderId: new RegExp(`^${escaped}$`, 'i') },
        { reference: new RegExp(`^${escaped}$`, 'i') },
        { customerEmail: new RegExp(`^${escaped}$`, 'i') },
      ],
    })
      .sort({ paidAt: -1 })
      .limit(30)
      .lean();
    return docs.map(({ _id, ...rest }) => rest as PaymentTransaction);
  },

  async getAllTransactions(): Promise<PaymentTransaction[]> {
    requireDatabaseConnection();
    const docs = await PaymentTransactionModel.find().sort({ paidAt: -1 }).limit(300).lean();
    return docs.map(({ _id, ...rest }) => rest as PaymentTransaction);
  },

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.isKeyConfigured() || !payload || !signature) return false;
    const hash = crypto
      .createHmac('sha512', env.paystackSecretKey)
      .update(payload, 'utf8')
      .digest('hex');
    return safeTimingEqual(hash.toLowerCase(), signature.trim().toLowerCase());
  },
};
