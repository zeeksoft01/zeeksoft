import { Router } from 'express';
import { authController } from '../controllers';
import { createRateLimiter, requireAuth, validate } from '../middlewares';
import {
  authLoginSchema,
  authRegisterSchema,
  becomeAffiliateSchema,
  forgotPasswordSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validations';

const router = Router();
const authRegisterLimiter = createRateLimiter(60_000, 15, 'auth-reg');
const authLoginLimiter = createRateLimiter(5 * 60_000, 20, 'auth-login');
const authRecoveryLimiter = createRateLimiter(5 * 60_000, 15, 'auth-recovery');

router.post('/auth/register', authRegisterLimiter, validate(authRegisterSchema), authController.register);
router.post('/auth/verify-email', authRecoveryLimiter, validate(verifyEmailSchema), authController.verifyEmail);
router.post(
  '/auth/resend-verification',
  authRecoveryLimiter,
  validate(resendVerificationSchema),
  authController.resendVerification
);
router.post('/auth/login', authLoginLimiter, validate(authLoginSchema), authController.login);
router.post(
  '/auth/forgot-password',
  authRecoveryLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);
router.post(
  '/auth/reset-password',
  authRecoveryLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);
router.get('/auth/me', requireAuth, authController.me);
router.post(
  '/auth/become-affiliate',
  requireAuth,
  validate(becomeAffiliateSchema),
  authController.becomeAffiliate
);

export default router;
