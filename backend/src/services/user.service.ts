import crypto from 'crypto';
import mongoose from 'mongoose';
import { Affiliate, SystemUser, UserRole, UserStatus } from '../types';
import {
  AffiliateCommissionModel,
  AffiliateLedgerModel,
  AffiliateModel,
  AffiliateWithdrawalModel,
  AuthTokenModel,
  OrderModel,
  ReferralClickModel,
  UserModel,
} from '../models';
import { AffiliateRecord } from '../models/Affiliate.model';
import { requireDatabaseConnection } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { auditService } from './audit.service';
import { signAuthToken } from '../middlewares/auth.middleware';
import { emailContactService } from './emailContact.service';
import { emailService, getPublicAppUrl } from './email.service';
import { safeTimingEqual } from '../utils/security';

const sha256Hex = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

const generateSixDigitCode = (): string =>
  String(crypto.randomInt(100000, 1000000));

export const hashUserPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
};

export const verifyUserPassword = (password: string, storedHash?: string): boolean => {
  if (!password || !storedHash || !storedHash.includes(':')) {
    return false;
  }
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return safeTimingEqual(key, derived);
  } catch {
    return false;
  }
};

export const sanitizeUser = (
  doc: Omit<SystemUser, '_id'> & { _id: unknown }
): Omit<SystemUser, 'passwordHash'> => {
  const { passwordHash: _ignored, _id, ...safe } = doc;
  return {
    _id: String(_id),
    fullName: safe.fullName || safe.name || '',
    name: safe.name || safe.fullName || '',
    email: safe.email,
    phone: safe.phone || '',
    profilePicture: safe.profilePicture,
    role: safe.role,
    status: safe.status,
    isVerified: Boolean(safe.isVerified),
    isActive: safe.isActive !== false && safe.status === 'active',
    createdBy: safe.createdBy || '',
    verifiedBy: safe.verifiedBy || '',
    verifiedAt: safe.verifiedAt || '',
    lastLoginAt: safe.lastLoginAt || '',
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt,
  };
};

export const isAdminRole = (role: string): boolean => role === 'admin';

export const composeAffiliateDto = (
  aff: AffiliateRecord,
  user: (Omit<SystemUser, '_id'> & { _id: unknown }) | Omit<SystemUser, 'passwordHash'>
): Affiliate => ({
  _id: String(aff._id),
  userId: String(aff.userId),
  fullName: user.fullName || user.name || '',
  email: user.email,
  phone: user.phone || '',
  profilePicture: user.profilePicture,
  referralCode: aff.referralCode,
  status: user.status,
  bankName: aff.bankName || '',
  accountNumber: aff.accountNumber || '',
  accountName: aff.accountName || '',
  availableBalance: aff.availableBalance || 0,
  pendingBalance: aff.pendingBalance || 0,
  totalEarned: aff.totalEarned || 0,
  totalWithdrawn: aff.totalWithdrawn || 0,
  reservedWithdrawalBalance: aff.reservedWithdrawalBalance || 0,
  totalReferredSalesCount: aff.totalReferredSalesCount || 0,
  totalClicks: aff.totalClicks || 0,
  createdAt: aff.createdAt,
  updatedAt: aff.updatedAt,
});

export const userService = {
  async generateUniqueReferralCode(): Promise<string> {
    let refCode = `ZEEK${Math.floor(10000 + Math.random() * 90000)}`;
    while (await AffiliateModel.exists({ referralCode: refCode })) {
      refCode = `ZEEK${Math.floor(10000 + Math.random() * 90000)}`;
    }
    return refCode;
  },

  async ensureAffiliateProfile(
    userId: string,
    bankDetails?: { bankName?: string; accountNumber?: string; accountName?: string }
  ): Promise<AffiliateRecord> {
    requireDatabaseConnection();
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(400, 'Invalid user ObjectId for affiliate profile.');
    }
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const existing = await AffiliateModel.findOne({ userId: userObjectId }).lean();
    if (existing) {
      if (
        bankDetails &&
        (bankDetails.bankName || bankDetails.accountNumber || bankDetails.accountName)
      ) {
        const updated = await AffiliateModel.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              ...(bankDetails.bankName ? { bankName: bankDetails.bankName.trim() } : {}),
              ...(bankDetails.accountNumber ? { accountNumber: bankDetails.accountNumber.trim() } : {}),
              ...(bankDetails.accountName ? { accountName: bankDetails.accountName.trim() } : {}),
              updatedAt: new Date().toISOString(),
            },
          },
          { new: true }
        ).lean();
        return updated as AffiliateRecord;
      }
      return existing as AffiliateRecord;
    }

    const now = new Date().toISOString();
    const referralCode = await this.generateUniqueReferralCode();
    const created = await AffiliateModel.create({
      userId: userObjectId,
      referralCode,
      bankName: (bankDetails?.bankName || '').trim(),
      accountNumber: (bankDetails?.accountNumber || '').trim(),
      accountName: (bankDetails?.accountName || '').trim(),
      availableBalance: 0,
      pendingBalance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      reservedWithdrawalBalance: 0,
      totalReferredSalesCount: 0,
      totalClicks: 0,
      createdAt: now,
      updatedAt: now,
    });
    return created.toObject() as AffiliateRecord;
  },

  async syncLegacyUsersToUnifiedCollection(): Promise<void> {
    requireDatabaseConnection();

    // Clean obsolete indexes from prior schema versions so unique constraints align
    await UserModel.collection.dropIndex('id_1').catch(() => {});
    await UserModel.collection.dropIndex('referralCode_1').catch(() => {});
    await AffiliateModel.collection.dropIndex('id_1').catch(() => {});
    await AffiliateModel.collection.dropIndex('email_1').catch(() => {});
    await mongoose.connection.db?.dropCollection('adminusers').catch(() => {});

    // 1. Normalize legacy roles on users collection
    await UserModel.updateMany(
      { role: 'super_admin' as unknown as UserRole },
      { $set: { role: 'admin' } }
    ).catch(() => {});
    await UserModel.updateMany(
      { role: { $in: ['moderator', 'support'] as unknown as UserRole[] } },
      { $set: { role: 'user' } }
    ).catch(() => {});

    // Build lookup map of legacy string user.id -> user._id ObjectId
    const oldUserIdMap = new Map<string, mongoose.Types.ObjectId>();
    const rawUsers = await UserModel.collection.find({}).toArray();
    for (const rawUser of rawUsers) {
      if (typeof rawUser.id === 'string' && rawUser.id) {
        oldUserIdMap.set(rawUser.id, rawUser._id as mongoose.Types.ObjectId);
      }
      // Also extract any embedded affiliate fields from prior versions
      if (rawUser.role === 'affiliate' || (typeof rawUser.referralCode === 'string' && rawUser.referralCode)) {
        const existingAff = await AffiliateModel.collection.findOne({
          $or: [
            { userId: rawUser._id },
            ...(typeof rawUser.id === 'string' ? [{ userId: rawUser.id }] : []),
            ...(rawUser.referralCode ? [{ referralCode: rawUser.referralCode }] : []),
          ],
        });
        if (!existingAff) {
          const referralCode =
            typeof rawUser.referralCode === 'string' && rawUser.referralCode.trim()
              ? rawUser.referralCode.trim().toUpperCase()
              : await this.generateUniqueReferralCode();
          await AffiliateModel.create({
            userId: rawUser._id as mongoose.Types.ObjectId,
            referralCode,
            bankName: String(rawUser.bankName || ''),
            accountNumber: String(rawUser.accountNumber || ''),
            accountName: String(rawUser.accountName || ''),
            availableBalance: Number(rawUser.availableBalance || 0),
            pendingBalance: Number(rawUser.pendingBalance || 0),
            totalEarned: Number(rawUser.totalEarned || 0),
            totalWithdrawn: Number(rawUser.totalWithdrawn || 0),
            reservedWithdrawalBalance: Number(rawUser.reservedWithdrawalBalance || 0),
            totalReferredSalesCount: Number(rawUser.totalReferredSalesCount || 0),
            totalClicks: Number(rawUser.totalClicks || 0),
            createdAt: String(rawUser.createdAt || new Date().toISOString()),
            updatedAt: String(rawUser.updatedAt || new Date().toISOString()),
          }).catch(() => {});
        }
      }
    }

    // 2. Migrate affiliates collection: ensure userId is ObjectId referencing users._id, strip legacy id & user fields
    const oldAffIdMap = new Map<string, string>();
    const rawAffiliates = await AffiliateModel.collection.find({}).toArray();
    for (const aff of rawAffiliates) {
      let userObjId: mongoose.Types.ObjectId | null = null;
      if (aff.userId instanceof mongoose.Types.ObjectId) {
        userObjId = aff.userId;
      } else if (typeof aff.userId === 'string') {
        if (oldUserIdMap.has(aff.userId)) {
          userObjId = oldUserIdMap.get(aff.userId)!;
        } else if (mongoose.Types.ObjectId.isValid(aff.userId)) {
          userObjId = new mongoose.Types.ObjectId(aff.userId);
        }
      }

      if (!userObjId) {
        const cleanEmail = typeof aff.email === 'string' ? aff.email.trim().toLowerCase() : '';
        if (cleanEmail) {
          const existingUser = await UserModel.findOne({ email: cleanEmail }).lean();
          if (existingUser) {
            userObjId = existingUser._id as unknown as mongoose.Types.ObjectId;
          } else {
            const now = String(aff.createdAt || new Date().toISOString());
            const createdUser = await UserModel.create({
              fullName: String(aff.fullName || 'Affiliate Partner'),
              name: String(aff.fullName || 'Affiliate Partner'),
              email: cleanEmail,
              phone: String(aff.phone || ''),
              passwordHash:
                typeof aff.passwordHash === 'string' && aff.passwordHash
                  ? aff.passwordHash
                  : hashUserPassword(crypto.randomBytes(12).toString('hex')),
              profilePicture: typeof aff.profilePicture === 'string' ? aff.profilePicture : undefined,
              role: 'affiliate',
              status: aff.status === 'suspended' ? 'suspended' : 'active',
              isVerified: true,
              isActive: aff.status !== 'suspended',
              createdBy: 'Migrated Affiliate',
              verifiedBy: 'System',
              verifiedAt: now,
              lastLoginAt: '',
              createdAt: now,
              updatedAt: String(aff.updatedAt || now),
            }).catch(() => null);
            if (createdUser) {
              userObjId = createdUser._id as unknown as mongoose.Types.ObjectId;
            }
          }
        }
      }

      if (typeof aff.id === 'string' && aff.id) {
        oldAffIdMap.set(aff.id, String(aff._id));
      }

      await AffiliateModel.collection
        .updateOne(
          { _id: aff._id },
          {
            ...(userObjId ? { $set: { userId: userObjId } } : {}),
            $unset: {
              id: '',
              email: '',
              passwordHash: '',
              fullName: '',
              phone: '',
              status: '',
              profilePicture: '',
            },
          }
        )
        .catch(() => {});
    }

    // Remap historical affiliateId references from old string `aff-...` to new String(aff._id)
    for (const [oldAffId, newAffId] of oldAffIdMap.entries()) {
      await Promise.all([
        OrderModel.updateMany({ affiliateId: oldAffId }, { $set: { affiliateId: newAffId } }).catch(() => {}),
        ReferralClickModel.updateMany({ affiliateId: oldAffId }, { $set: { affiliateId: newAffId } }).catch(() => {}),
        AffiliateCommissionModel.updateMany({ affiliateId: oldAffId }, { $set: { affiliateId: newAffId } }).catch(() => {}),
        AffiliateWithdrawalModel.updateMany({ affiliateId: oldAffId }, { $set: { affiliateId: newAffId } }).catch(() => {}),
        AffiliateLedgerModel.updateMany({ affiliateId: oldAffId }, { $set: { affiliateId: newAffId } }).catch(() => {}),
      ]);
    }

    // 4. Strip legacy `id` and any embedded affiliate-only fields from all users documents
    await UserModel.collection
      .updateMany(
        {},
        {
          $unset: {
            id: '',
            referralCode: '',
            bankName: '',
            accountNumber: '',
            accountName: '',
            availableBalance: '',
            pendingBalance: '',
            totalEarned: '',
            totalWithdrawn: '',
            reservedWithdrawalBalance: '',
            totalReferredSalesCount: '',
            totalClicks: '',
          },
        }
      )
      .catch(() => {});
  },

  async getAllUsers(filters?: {
    role?: string;
    status?: string;
  }): Promise<Omit<SystemUser, 'passwordHash'>[]> {
    requireDatabaseConnection();
    const query: Record<string, unknown> = {};
    if (filters?.role && filters.role !== 'all') {
      if (filters.role === 'admins') {
        query.role = 'admin';
      } else {
        query.role = filters.role;
      }
    }
    if (filters?.status && filters.status !== 'all') {
      query.status = filters.status;
    }

    const docs = await UserModel.find(query).sort({ createdAt: -1 }).lean();
    return docs.map((doc) => sanitizeUser(doc));
  },

  async getUserById(id: string): Promise<SystemUser | null> {
    requireDatabaseConnection();
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
    const doc = await UserModel.findById(id).lean();
    if (!doc) return null;
    return { ...doc, _id: String(doc._id) } as SystemUser;
  },

  async getUserByEmail(email: string): Promise<SystemUser | null> {
    requireDatabaseConnection();
    const cleanEmail = email.trim().toLowerCase();
    const doc = await UserModel.findOne({ email: cleanEmail }).lean();
    if (!doc) return null;
    return { ...doc, _id: String(doc._id) } as SystemUser;
  },

  async registerUnifiedUser(input: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    role?: 'affiliate' | 'user';
    profilePicture?: string;
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
    marketingConsent?: boolean;
  }): Promise<{
    requiresVerification: boolean;
    email: string;
    token?: string;
    user: Omit<SystemUser, 'passwordHash'>;
    affiliate: Affiliate | null;
    emailSent: boolean;
  }> {
    requireDatabaseConnection();
    const cleanEmail = input.email.trim().toLowerCase();
    const existing = await UserModel.findOne({ email: cleanEmail }).lean();

    if (input.role === 'user') {
      throw new ApiError(
        400,
        'Standard user registration is not active yet. Please register via Become Affiliate.'
      );
    }
    if ((input.role as string) === 'admin') {
      throw new ApiError(400, 'Admin accounts cannot be self-registered.');
    }

    const cleanName = input.fullName.trim();
    if (!cleanName) {
      throw new ApiError(400, 'Full name is required.');
    }

    const now = new Date().toISOString();
    let userDocToVerify: Omit<SystemUser, '_id'> & { _id: unknown };

    if (existing) {
      if (existing.role === 'affiliate' && !existing.isVerified && existing.status === 'pending') {
        const refreshed = await UserModel.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              fullName: cleanName,
              name: cleanName,
              phone: (input.phone || existing.phone || '').trim(),
              passwordHash: hashUserPassword(input.password),
              ...(input.profilePicture ? { profilePicture: input.profilePicture } : {}),
              updatedAt: now,
            },
          },
          { new: true }
        ).lean();
        userDocToVerify = refreshed!;
      } else {
        throw new ApiError(409, 'A user account with this email address already exists.');
      }
    } else {
      const createdDoc = await UserModel.create({
        fullName: cleanName,
        name: cleanName,
        email: cleanEmail,
        phone: (input.phone || '').trim(),
        passwordHash: hashUserPassword(input.password),
        profilePicture: input.profilePicture,
        role: 'affiliate',
        status: 'pending',
        isVerified: false,
        isActive: false,
        createdBy: 'Self Registration',
        verifiedBy: 'Pending Email Verification',
        verifiedAt: '',
        lastLoginAt: '',
        createdAt: now,
        updatedAt: now,
      });
      userDocToVerify = createdDoc.toObject();
    }

    const userIdStr = String(userDocToVerify._id);
    const affRecord = await this.ensureAffiliateProfile(userIdStr, {
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
    });
    const affiliateDto = composeAffiliateDto(affRecord, userDocToVerify);

    // Issue single-use 20-minute email verification code (invalidate prior unused codes for this email)
    const code = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    await AuthTokenModel.updateMany(
      { email: cleanEmail, purpose: 'email_verify', usedAt: null },
      { $set: { usedAt: now } }
    );
    await AuthTokenModel.create({
      id: `tok-ev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: userIdStr,
      email: cleanEmail,
      purpose: 'email_verify',
      codeHash: sha256Hex(code),
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      usedAt: null,
      createdAt: now,
    });

    const mailRes = await emailService
      .sendAffiliateVerificationEmail({
        fullName: cleanName,
        email: cleanEmail,
        code,
        expiresInMinutes: 20,
      })
      .catch((err) => ({ sent: false, error: String(err) }));

    await emailContactService
      .upsertCollectedEmail({
        email: cleanEmail,
        fullName: cleanName,
        whatsApp: input.phone,
        source: 'affiliate_registration',
        categories: ['Affiliates', 'Newly Registered Affiliates'],
        userId: userIdStr,
        affiliateId: affiliateDto._id,
        explicitOptIn: Boolean(input.marketingConsent),
        consentSource: input.marketingConsent ? 'registration_opt_in' : undefined,
      })
      .catch(console.error);

    await auditService.addLog(
      'Affiliate Verification Code Sent',
      `Pending affiliate verification created for ${cleanEmail} (User ID: ${userIdStr})`,
      'System'
    );

    return {
      requiresVerification: true,
      email: cleanEmail,
      user: sanitizeUser(userDocToVerify),
      affiliate: affiliateDto,
      emailSent: Boolean(mailRes?.sent),
    };
  },

  async verifyAffiliateEmailCode(
    email: string,
    code: string
  ): Promise<{
    token: string;
    user: Omit<SystemUser, 'passwordHash'>;
    affiliate: Affiliate;
  }> {
    requireDatabaseConnection();
    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.trim();
    const now = new Date().toISOString();

    const userDoc = await UserModel.findOne({ email: cleanEmail }).lean();
    if (!userDoc || userDoc.role !== 'affiliate') {
      throw new ApiError(404, 'No affiliate registration found for that email address.');
    }
    if (userDoc.status === 'suspended' || userDoc.status === 'disabled') {
      throw new ApiError(403, `Your account is "${userDoc.status}" and cannot be verified.`);
    }

    const tokenDoc = await AuthTokenModel.findOne({
      email: cleanEmail,
      purpose: 'email_verify',
      usedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!tokenDoc) {
      throw new ApiError(
        400,
        'No active verification code found. Please click "Resend Verification Code".'
      );
    }
    if (tokenDoc.expiresAt <= now) {
      await AuthTokenModel.updateOne({ id: tokenDoc.id }, { $set: { usedAt: now } });
      throw new ApiError(
        400,
        'Your verification code has expired. Please request a new verification code.'
      );
    }
    if (tokenDoc.attempts >= tokenDoc.maxAttempts) {
      await AuthTokenModel.updateOne({ id: tokenDoc.id }, { $set: { usedAt: now } });
      throw new ApiError(
        400,
        'Maximum verification attempts exceeded. Please request a new verification code.'
      );
    }

    const candidateHash = sha256Hex(cleanCode);
    if (!safeTimingEqual(candidateHash, tokenDoc.codeHash)) {
      const incremented = await AuthTokenModel.findOneAndUpdate(
        { id: tokenDoc.id },
        { $inc: { attempts: 1 } },
        { new: true }
      ).lean();
      if (incremented && incremented.attempts >= incremented.maxAttempts) {
        await AuthTokenModel.updateOne({ id: tokenDoc.id }, { $set: { usedAt: now } });
        throw new ApiError(
          400,
          'Too many invalid code attempts. Please request a new verification code.'
        );
      }
      throw new ApiError(400, 'Invalid verification code. Please check your email and try again.');
    }

    // Consume verification token atomically (single-use)
    const consumed = await AuthTokenModel.findOneAndUpdate(
      { id: tokenDoc.id, usedAt: null },
      { $set: { usedAt: now } },
      { new: true }
    ).lean();
    if (!consumed) {
      throw new ApiError(400, 'This verification code has already been used.');
    }

    await AuthTokenModel.updateMany(
      { email: cleanEmail, purpose: 'email_verify', usedAt: null },
      { $set: { usedAt: now } }
    );

    const updatedUserDoc = await UserModel.findByIdAndUpdate(
      userDoc._id,
      {
        $set: {
          status: 'active',
          isVerified: true,
          isActive: true,
          verifiedBy: 'Email Code Verification',
          verifiedAt: now,
          lastLoginAt: now,
          updatedAt: now,
        },
      },
      { new: true }
    ).lean();

    const cleanUser = sanitizeUser(updatedUserDoc!);
    const affRecord = await this.ensureAffiliateProfile(cleanUser._id);
    const affiliateDto = composeAffiliateDto(affRecord, cleanUser);

    emailService
      .sendAffiliateActivatedEmail({
        fullName: cleanUser.fullName,
        email: cleanUser.email,
        referralCode: affiliateDto.referralCode,
      })
      .catch(console.error);

    await auditService.addLog(
      'Affiliate Email Verified',
      `Affiliate ${cleanEmail} (${cleanUser._id}) confirmed email ownership and activated account`,
      cleanEmail
    );

    const token = signAuthToken({
      _id: cleanUser._id,
      email: cleanUser.email,
      name: cleanUser.fullName || cleanUser.email,
      role: cleanUser.role,
      authType: 'db_user',
    });

    return {
      token,
      user: cleanUser,
      affiliate: affiliateDto,
    };
  },

  async resendAffiliateVerificationCode(
    email: string
  ): Promise<{ success: boolean; emailSent: boolean; message: string }> {
    requireDatabaseConnection();
    const cleanEmail = email.trim().toLowerCase();
    const userDoc = await UserModel.findOne({ email: cleanEmail }).lean();

    if (!userDoc || userDoc.role !== 'affiliate') {
      throw new ApiError(404, 'No affiliate account found for that email address.');
    }
    if (userDoc.isVerified && userDoc.status === 'active') {
      throw new ApiError(400, 'This email address is already verified. Please sign in.');
    }
    if (userDoc.status === 'suspended' || userDoc.status === 'disabled') {
      throw new ApiError(403, `Your account status is "${userDoc.status}".`);
    }

    const latest = await AuthTokenModel.findOne({
      email: cleanEmail,
      purpose: 'email_verify',
    })
      .sort({ createdAt: -1 })
      .lean();

    if (latest) {
      const elapsedMs = Date.now() - new Date(latest.createdAt).getTime();
      if (elapsedMs < 30_000) {
        const waitSec = Math.ceil((30_000 - elapsedMs) / 1000);
        throw new ApiError(
          429,
          `Please wait ${waitSec} seconds before requesting another verification code.`
        );
      }
    }

    const now = new Date().toISOString();
    const code = generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();

    await AuthTokenModel.updateMany(
      { email: cleanEmail, purpose: 'email_verify', usedAt: null },
      { $set: { usedAt: now } }
    );

    await AuthTokenModel.create({
      id: `tok-ev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: String(userDoc._id),
      email: cleanEmail,
      purpose: 'email_verify',
      codeHash: sha256Hex(code),
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      usedAt: null,
      createdAt: now,
    });

    const mailRes = await emailService
      .sendAffiliateVerificationEmail({
        fullName: userDoc.fullName || userDoc.name || 'Partner',
        email: cleanEmail,
        code,
        expiresInMinutes: 20,
      })
      .catch(() => ({ sent: false }));

    return {
      success: true,
      emailSent: Boolean(mailRes?.sent),
      message: mailRes?.sent
        ? `A new verification code has been sent to ${cleanEmail}.`
        : 'Verification code regenerated. Email delivery may be delayed; verify SMTP/Brevo settings if needed.',
    };
  },

  async requestPasswordReset(
    email: string,
    appOrigin?: string
  ): Promise<{ success: boolean; message: string }> {
    requireDatabaseConnection();
    const cleanEmail = email.trim().toLowerCase();
    const genericMsg =
      'If an account exists for that email address, a one-time password reset code and link have been sent.';

    const userDoc = await UserModel.findOne({ email: cleanEmail }).lean();
    if (!userDoc || userDoc.status === 'suspended' || userDoc.status === 'disabled') {
      return { success: true, message: genericMsg };
    }

    const latest = await AuthTokenModel.findOne({
      email: cleanEmail,
      purpose: 'password_reset',
    })
      .sort({ createdAt: -1 })
      .lean();

    if (latest) {
      const elapsedMs = Date.now() - new Date(latest.createdAt).getTime();
      if (elapsedMs < 30_000) {
        return { success: true, message: genericMsg };
      }
    }

    const now = new Date().toISOString();
    const code = generateSixDigitCode();
    const rawUrlToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await AuthTokenModel.updateMany(
      { email: cleanEmail, purpose: 'password_reset', usedAt: null },
      { $set: { usedAt: now } }
    );

    await AuthTokenModel.create({
      id: `tok-pr-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      userId: String(userDoc._id),
      email: cleanEmail,
      purpose: 'password_reset',
      codeHash: sha256Hex(code),
      tokenHash: sha256Hex(rawUrlToken),
      attempts: 0,
      maxAttempts: 5,
      expiresAt,
      usedAt: null,
      createdAt: now,
    });

    const base = (appOrigin || getPublicAppUrl()).replace(/\/$/, '');
    const resetUrl = `${base}/?resetToken=${encodeURIComponent(
      rawUrlToken
    )}&email=${encodeURIComponent(cleanEmail)}`;

    await emailService
      .sendPasswordResetEmail({
        fullName: userDoc.fullName || userDoc.name || 'Valued User',
        email: cleanEmail,
        code,
        resetUrl,
        expiresInMinutes: 15,
      })
      .catch(console.error);

    await auditService.addLog(
      'Password Reset Requested',
      `One-time password reset code generated for ${cleanEmail}`,
      cleanEmail
    );

    return { success: true, message: genericMsg };
  },

  async resetPasswordWithTokenOrCode(input: {
    email: string;
    code?: string;
    token?: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    requireDatabaseConnection();
    const cleanEmail = input.email.trim().toLowerCase();
    const candidate = (input.token || input.code || '').trim();
    const now = new Date().toISOString();

    if (!candidate) {
      throw new ApiError(400, 'Please enter your reset code or open your reset link.');
    }

    const userDoc = await UserModel.findOne({ email: cleanEmail }).lean();
    if (!userDoc || userDoc.status === 'suspended' || userDoc.status === 'disabled') {
      throw new ApiError(
        400,
        'Invalid, expired, or already used password reset code. Please request a new one.'
      );
    }

    const tokenDoc = await AuthTokenModel.findOne({
      email: cleanEmail,
      purpose: 'password_reset',
      usedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!tokenDoc || tokenDoc.expiresAt <= now || tokenDoc.attempts >= tokenDoc.maxAttempts) {
      if (tokenDoc && tokenDoc.usedAt === null) {
        await AuthTokenModel.updateOne({ id: tokenDoc.id }, { $set: { usedAt: now } });
      }
      throw new ApiError(
        400,
        'Invalid, expired, or already used password reset code. Please request a new one.'
      );
    }

    const candidateHash = sha256Hex(candidate);
    const matchesCode = safeTimingEqual(candidateHash, tokenDoc.codeHash);
    const matchesToken = Boolean(
      tokenDoc.tokenHash && safeTimingEqual(candidateHash, tokenDoc.tokenHash)
    );

    if (!matchesCode && !matchesToken) {
      const incremented = await AuthTokenModel.findOneAndUpdate(
        { id: tokenDoc.id },
        { $inc: { attempts: 1 } },
        { new: true }
      ).lean();
      if (incremented && incremented.attempts >= incremented.maxAttempts) {
        await AuthTokenModel.updateOne({ id: tokenDoc.id }, { $set: { usedAt: now } });
      }
      throw new ApiError(
        400,
        'Invalid or expired password reset code. Please check your email or request a new code.'
      );
    }

    // Atomically mark token as used so it can never be reused
    const consumed = await AuthTokenModel.findOneAndUpdate(
      { id: tokenDoc.id, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
      { new: true }
    ).lean();

    if (!consumed) {
      throw new ApiError(
        400,
        'This password reset link or code has expired or already been used.'
      );
    }

    await AuthTokenModel.updateMany(
      { email: cleanEmail, purpose: 'password_reset', usedAt: null },
      { $set: { usedAt: now } }
    );

    await UserModel.updateOne(
      { _id: userDoc._id },
      {
        $set: {
          passwordHash: hashUserPassword(input.newPassword),
          updatedAt: now,
        },
      }
    );

    emailService
      .sendPasswordChangedEmail({
        fullName: userDoc.fullName || userDoc.name || 'Valued User',
        email: cleanEmail,
      })
      .catch(console.error);

    await auditService.addLog(
      'Password Reset Completed',
      `Password reset successfully for ${cleanEmail}`,
      cleanEmail
    );

    return {
      success: true,
      message: 'Your password has been updated. You can now sign in with your new password.',
    };
  },

  async authenticateUnifiedUser(
    email: string,
    password: string
  ): Promise<{
    token: string;
    user: Omit<SystemUser, 'passwordHash'>;
    affiliate: Affiliate | null;
  }> {
    requireDatabaseConnection();
    const cleanEmail = email.trim().toLowerCase();
    const doc = await UserModel.findOne({ email: cleanEmail }).lean();

    if (!doc || !verifyUserPassword(password, doc.passwordHash)) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    if (doc.role === 'affiliate' && (doc.isVerified !== true || doc.status === 'pending')) {
      throw new ApiError(
        403,
        'Your affiliate email is not verified yet. Please enter the verification code sent to your email.',
        { requiresVerification: true, email: cleanEmail }
      );
    }

    if (doc.status !== 'active' || doc.isActive === false) {
      throw new ApiError(
        403,
        `Your account status is currently "${doc.status}". Please contact support or an administrator.`
      );
    }

    if (doc.role === 'admin' && doc.isVerified !== true) {
      throw new ApiError(
        403,
        'Your admin account is not verified yet. Ask an existing verified administrator to verify your account.'
      );
    }

    const now = new Date().toISOString();
    await UserModel.updateOne(
      { _id: doc._id },
      { $set: { lastLoginAt: now, updatedAt: now } }
    );

    const updatedUser = sanitizeUser({
      ...doc,
      lastLoginAt: now,
      updatedAt: now,
    });

    let affiliateDto: Affiliate | null = null;
    if (updatedUser.role === 'affiliate') {
      const affRecord = await this.ensureAffiliateProfile(updatedUser._id);
      affiliateDto = composeAffiliateDto(affRecord, updatedUser);
    }

    const token = signAuthToken({
      _id: updatedUser._id,
      email: updatedUser.email,
      name: updatedUser.fullName || updatedUser.email,
      role: updatedUser.role,
      authType: 'db_user',
    });

    return {
      token,
      user: updatedUser,
      affiliate: affiliateDto,
    };
  },

  async createUser(
    input: {
      fullName?: string;
      name?: string;
      email: string;
      phone?: string;
      password: string;
      role?: UserRole;
      status?: UserStatus;
      isVerified?: boolean;
      bankName?: string;
      accountNumber?: string;
      accountName?: string;
      profilePicture?: string;
    },
    createdByLabel: string
  ): Promise<Omit<SystemUser, 'passwordHash'>> {
    requireDatabaseConnection();
    const cleanEmail = input.email.trim().toLowerCase();
    const existing = await UserModel.findOne({ email: cleanEmail }).lean();
    if (existing) {
      throw new ApiError(409, 'A user account with this email address already exists.');
    }

    const displayName = (input.fullName || input.name || '').trim();
    if (!displayName) {
      throw new ApiError(400, 'Full name is required.');
    }

    const now = new Date().toISOString();
    const assignedRole: UserRole = input.role || 'affiliate';
    const assignedStatus: UserStatus = input.status || 'active';
    const verified = Boolean(input.isVerified);

    const createdDoc = await UserModel.create({
      fullName: displayName,
      name: displayName,
      email: cleanEmail,
      phone: (input.phone || '').trim(),
      passwordHash: hashUserPassword(input.password),
      profilePicture: input.profilePicture,
      role: assignedRole,
      status: assignedStatus,
      isVerified: verified,
      isActive: assignedStatus === 'active',
      createdBy: createdByLabel,
      verifiedBy: verified ? createdByLabel : '',
      verifiedAt: verified ? now : '',
      lastLoginAt: '',
      createdAt: now,
      updatedAt: now,
    });

    const createdObj = createdDoc.toObject();
    const createdIdStr = String(createdObj._id);

    let createdAffiliateId: string | undefined;
    if (assignedRole === 'affiliate') {
      const aff = await this.ensureAffiliateProfile(createdIdStr, {
        bankName: input.bankName,
        accountNumber: input.accountNumber,
        accountName: input.accountName,
      });
      createdAffiliateId = String(aff._id);
    }

    if (assignedRole !== 'admin') {
      await emailContactService
        .upsertCollectedEmail({
          email: cleanEmail,
          fullName: displayName,
          whatsApp: input.phone,
          source: assignedRole === 'affiliate' ? 'affiliate_registration' : 'customer_registration',
          categories:
            assignedRole === 'affiliate' ? ['Affiliates', 'Newly Registered Affiliates'] : undefined,
          userId: createdIdStr,
          affiliateId: createdAffiliateId,
        })
        .catch(() => {});
    }

    await auditService.addLog(
      'Create User Account',
      `Registered ${cleanEmail} (role: ${assignedRole}, status: ${assignedStatus}, verified: ${verified})`,
      createdByLabel
    );

    return sanitizeUser(createdObj);
  },

  async updateUser(
    id: string,
    updates: {
      fullName?: string;
      name?: string;
      phone?: string;
      role?: UserRole;
      status?: UserStatus;
      isVerified?: boolean;
      isActive?: boolean;
      password?: string;
      bankName?: string;
      accountNumber?: string;
      accountName?: string;
    },
    actingAdmin: { _id: string; label: string }
  ): Promise<Omit<SystemUser, 'passwordHash'>> {
    requireDatabaseConnection();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(404, 'User account not found.');
    }
    const existing = await UserModel.findById(id).lean();
    if (!existing) {
      throw new ApiError(404, 'User account not found.');
    }

    const existingIdStr = String(existing._id);
    const nextStatus: UserStatus | undefined =
      updates.status !== undefined
        ? updates.status
        : typeof updates.isActive === 'boolean'
        ? updates.isActive
          ? 'active'
          : 'disabled'
        : undefined;

    if (existingIdStr === actingAdmin._id) {
      if (updates.isVerified === false) {
        throw new ApiError(400, 'You cannot unverify your own currently logged-in admin account.');
      }
      if (nextStatus && nextStatus !== 'active') {
        throw new ApiError(400, 'You cannot disable or suspend your own currently logged-in admin account.');
      }
      if (updates.role && !isAdminRole(updates.role)) {
        throw new ApiError(400, 'You cannot remove your own administrator role.');
      }
    }

    const now = new Date().toISOString();
    const setFields: Record<string, unknown> = { updatedAt: now };

    const updatedName = (updates.fullName || updates.name || '').trim();
    if (updatedName) {
      setFields.fullName = updatedName;
      setFields.name = updatedName;
    }
    if (typeof updates.phone === 'string') {
      setFields.phone = updates.phone.trim();
    }
    if (updates.role) {
      setFields.role = updates.role;
    }
    if (nextStatus) {
      setFields.status = nextStatus;
      setFields.isActive = nextStatus === 'active';
    }
    if (typeof updates.isVerified === 'boolean') {
      setFields.isVerified = updates.isVerified;
      setFields.verifiedBy = updates.isVerified ? actingAdmin.label : '';
      setFields.verifiedAt = updates.isVerified ? now : '';
    }
    if (typeof updates.password === 'string' && updates.password.trim().length >= 6) {
      setFields.passwordHash = hashUserPassword(updates.password.trim());
    }

    const updated = await UserModel.findByIdAndUpdate(
      id,
      { $set: setFields },
      { new: true }
    ).lean();

    if (updates.role === 'affiliate') {
      await this.ensureAffiliateProfile(existingIdStr, {
        bankName: updates.bankName,
        accountNumber: updates.accountNumber,
        accountName: updates.accountName,
      });
    } else if (
      typeof updates.bankName === 'string' ||
      typeof updates.accountNumber === 'string' ||
      typeof updates.accountName === 'string'
    ) {
      const hasAff = await AffiliateModel.exists({ userId: new mongoose.Types.ObjectId(existingIdStr) });
      if (hasAff) {
        await this.ensureAffiliateProfile(existingIdStr, {
          bankName: updates.bankName,
          accountNumber: updates.accountNumber,
          accountName: updates.accountName,
        });
      }
    }

    await auditService.addLog(
      'Update User Account',
      `Updated user ${existing.email}: ${Object.keys(setFields)
        .filter((k) => k !== 'passwordHash' && k !== 'updatedAt')
        .join(', ')}`,
      actingAdmin.label
    );

    return sanitizeUser(updated!);
  },

  async deleteUser(id: string, actingAdmin: { _id: string; label: string }): Promise<boolean> {
    requireDatabaseConnection();
    if (!mongoose.Types.ObjectId.isValid(id)) return false;
    if (id === actingAdmin._id) {
      throw new ApiError(400, 'You cannot delete your own currently logged-in admin account.');
    }
    const deleted = await UserModel.findByIdAndDelete(id).lean();
    if (!deleted) return false;
    await AffiliateModel.deleteOne({ userId: deleted._id }).catch(() => {});
    await auditService.addLog(
      'Delete User Account',
      `Deleted user account: ${deleted.email} (${deleted.role})`,
      actingAdmin.label
    );
    return true;
  },
};
