import mongoose, { Schema } from 'mongoose';

export interface AuthTokenDoc {
  id: string;
  userId: string;
  email: string;
  purpose: 'email_verify' | 'password_reset';
  codeHash: string;
  tokenHash?: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  usedAt?: string | null;
  createdAt: string;
}

const authTokenSchema = new Schema<AuthTokenDoc>(
  {
    id: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: {
      type: String,
      enum: ['email_verify', 'password_reset'],
      required: true,
      index: true,
    },
    codeHash: { type: String, required: true, index: true },
    tokenHash: { type: String, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    expiresAt: { type: String, required: true, index: true },
    usedAt: { type: String, default: null },
    createdAt: { type: String, required: true },
  },
  { collection: 'auth_tokens', versionKey: false }
);

authTokenSchema.index({ email: 1, purpose: 1, usedAt: 1 });

export const AuthTokenModel = mongoose.model<AuthTokenDoc>('AuthToken', authTokenSchema);
