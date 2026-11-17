import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AuthenticatedAffiliateRequest } from '../middlewares/auth.middleware';
import { affiliateService } from '../services';
import { ApiError } from '../utils/ApiError';

export const affiliateController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await affiliateService.registerAffiliate(req.body);
    res.status(201).json({
      success: true,
      requiresVerification: result.requiresVerification,
      email: result.email,
      emailSent: result.emailSent,
      message: result.emailSent
        ? `Verification code sent to ${result.email}. Enter the code to activate your affiliate account.`
        : 'Affiliate registration saved. Please verify your email address with the verification code to activate your account.',
    });
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await affiliateService.loginAffiliate(email, password);
    res.json({
      success: true,
      affiliate: result.affiliate,
      token: result.token,
    });
  }),

  trackClick: asyncHandler(async (req: Request, res: Response) => {
    const { referralCode, targetPath } = req.body;
    const tracked = await affiliateService.trackReferralClick(referralCode, targetPath);
    res.json({
      success: true,
      tracked,
    });
  }),

  getDashboard: asyncHandler(async (req: AuthenticatedAffiliateRequest, res: Response) => {
    if (!req.affiliateAuth) {
      throw new ApiError(401, 'Unauthorized');
    }
    const dashboard = await affiliateService.getAffiliateDashboard(req.affiliateAuth.affiliateId, {
      period: typeof req.query.period === 'string' ? (req.query.period as any) : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      payoutFilter:
        typeof req.query.payoutFilter === 'string' ? (req.query.payoutFilter as any) : undefined,
    });
    res.json({
      success: true,
      ...dashboard,
    });
  }),

  requestWithdrawal: asyncHandler(async (req: AuthenticatedAffiliateRequest, res: Response) => {
    if (!req.affiliateAuth) {
      throw new ApiError(401, 'Unauthorized');
    }
    const withdrawal = await affiliateService.requestWithdrawal(
      req.affiliateAuth.affiliateId,
      req.body.amount
    );
    res.status(201).json({
      success: true,
      withdrawal,
      message: 'Withdrawal request submitted and pending admin review.',
    });
  }),
};
