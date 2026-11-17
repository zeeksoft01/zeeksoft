import mongoose, { Schema } from 'mongoose';
import { PaymentTransaction } from '../types';

const paymentTransactionSchema = new Schema<PaymentTransaction>(
  {
    id: { type: String, required: true, unique: true, index: true },
    reference: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, required: true, index: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'NGN' },
    gateway: { type: String, required: true, default: 'Paystack' },
    channel: { type: String },
    status: {
      type: String,
      enum: ['success', 'pending', 'failed', 'refunded'],
      default: 'success',
      index: true,
    },
    paidAt: { type: String, required: true, index: true },
    verifiedVia: {
      type: String,
      enum: ['webhook', 'callback', 'simulation', 'admin'],
      required: true,
      default: 'callback',
    },
    gatewayResponse: { type: String },
    metadata: { type: Schema.Types.Mixed },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true },
  },
  { collection: 'payment_transactions', versionKey: false }
);

paymentTransactionSchema.index({ customerEmail: 1, paidAt: -1 });
paymentTransactionSchema.index({ orderId: 1, status: 1 });

export const PaymentTransactionModel = mongoose.model<PaymentTransaction>(
  'PaymentTransaction',
  paymentTransactionSchema
);
