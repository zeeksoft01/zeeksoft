import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  TrendingUp,
  DollarSign,
  ShieldCheck,
  Copy,
  Check,
  LogOut,
  Wallet,
  Shield,
  Key,
  Lock,
  Mail,
  Send,
  MessageCircle,
  ArrowRight,
  Loader2,
  BookOpen,
  BarChart3,
  KeyRound,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  SiteSettings,
  SystemUser,
  Affiliate,
  AffiliateCommission,
  AffiliateWithdrawal,
  ReferralAttribution,
} from '../types';
import { api, ApiRequestError } from '../api/client';
import { AffiliateDashboardView } from './AffiliateDashboardView';

export type AuthPortalViewMode =
  | 'login'
  | 'register'
  | 'verify_email'
  | 'forgot_password'
  | 'reset_password';

interface AuthPortalModalProps {
  isOpen: boolean;
  initialMode?: AuthPortalViewMode;
  initialRegisterRole?: 'affiliate' | 'user';
  initialResetEmail?: string;
  initialResetToken?: string;
  authToken: string | null;
  authUser: SystemUser | null;
  settings: SiteSettings;
  onAuthSuccess: (payload: {
    token: string;
    user: SystemUser;
    affiliate?: Affiliate | null;
  }) => void;
  onLogout: () => void;
  onOpenAdminDashboard: () => void;
  onOpenAffiliateGuide?: () => void;
  onClose: () => void;
}

export const AuthPortalModal: React.FC<AuthPortalModalProps> = ({
  isOpen,
  initialMode = 'login',
  initialResetEmail = '',
  initialResetToken = '',
  authToken,
  authUser,
  settings,
  onAuthSuccess,
  onLogout,
  onOpenAdminDashboard,
  onOpenAffiliateGuide,
  onClose,
}) => {
  const [authTab, setAuthTab] = useState<AuthPortalViewMode>(initialMode);
  const [useMasterKey, setUseMasterKey] = useState(false);

  // General Sign In fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Become Affiliate Registration fields (default role: 'affiliate')
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Email Verification fields
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isResendingCode, setIsResendingCode] = useState(false);

  // Forgot & Reset Password fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [resetEmail, setResetEmail] = useState(initialResetEmail || '');
  const [resetCodeOrToken, setResetCodeOrToken] = useState(initialResetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  // Become-affiliate fields if an inactive 'user' account signs in
  const [becomeBankName, setBecomeBankName] = useState('');
  const [becomeAccountNumber, setBecomeAccountNumber] = useState('');
  const [becomeAccountName, setBecomeAccountName] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [copied, setCopied] = useState(false);

  // Affiliate dashboard state when user.role === 'affiliate'
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalAffiliate, setPortalAffiliate] = useState<Affiliate | null>(null);
  const [portalCommissions, setPortalCommissions] = useState<AffiliateCommission[]>([]);
  const [portalWithdrawals, setPortalWithdrawals] = useState<AffiliateWithdrawal[]>([]);
  const [portalReferredCustomers, setPortalReferredCustomers] = useState<ReferralAttribution[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showFullDashboard, setShowFullDashboard] = useState(false);

  // Password visibility toggles (display-only UI state; resets automatically on context switch)
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAuthTab(initialMode);
      setErrorMessage('');
      setNoticeMessage('');
      setUseMasterKey(false);
      setShowLoginPassword(false);
      setShowRegisterPassword(false);
      setShowNewPassword(false);
      setShowConfirmNewPassword(false);
      if (initialMode === 'reset_password') {
        setResetEmail(initialResetEmail || '');
        setResetCodeOrToken(initialResetToken || '');
      }
    }
  }, [isOpen, initialMode, initialResetEmail, initialResetToken]);

  useEffect(() => {
    setShowLoginPassword(false);
    setShowRegisterPassword(false);
    setShowNewPassword(false);
    setShowConfirmNewPassword(false);
  }, [authTab, useMasterKey]);

  const loadAffiliatePortal = async (tok: string) => {
    setPortalLoading(true);
    setErrorMessage('');
    try {
      const data = await api.getAffiliateDashboard(tok);
      setPortalAffiliate(data.affiliate);
      setPortalCommissions(data.commissions || []);
      setPortalWithdrawals(data.withdrawals || []);
      setPortalReferredCustomers(data.referredCustomers || []);
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.requiresVerification) {
        setPendingVerifyEmail(err.email || authUser?.email || '');
        setAuthTab('verify_email');
        onLogout();
      }
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load affiliate dashboard.');
    } finally {
      setPortalLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && authToken && authUser?.role === 'affiliate') {
      loadAffiliatePortal(authToken);
    } else {
      setPortalAffiliate(null);
      setShowFullDashboard(false);
    }
  }, [isOpen, authToken, authUser?.role]);

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setNoticeMessage('');
    setIsSubmitting(true);
    try {
      const res = await api.authLogin(
        loginPassword,
        useMasterKey ? undefined : loginEmail.trim()
      );
      onAuthSuccess({
        token: res.token,
        user: res.user,
        affiliate: res.affiliate,
      });
      setLoginPassword('');
      setShowLoginPassword(false);
      if (res.affiliate) {
        setPortalAffiliate(res.affiliate);
      }
      if (res.user.role === 'admin') {
        onClose();
        onOpenAdminDashboard();
      }
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.requiresVerification) {
        const targetEmail = (err.email || loginEmail || '').trim().toLowerCase();
        setPendingVerifyEmail(targetEmail);
        setVerificationCode('');
        setShowLoginPassword(false);
        setAuthTab('verify_email');
        setNoticeMessage(
          `Your affiliate email (${targetEmail}) requires verification before sign-in. Enter the 6-digit code sent to your inbox or click Resend Code.`
        );
        setErrorMessage('');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Sign in failed.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setNoticeMessage('');
    setIsSubmitting(true);
    try {
      const res = await api.authRegister({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        role: 'affiliate',
        bankName: bankName.trim(),
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        marketingConsent,
      });

      setPassword('');
      setShowRegisterPassword(false);
      setMarketingConsent(false);

      if (res.requiresVerification || !res.token || !res.user) {
        const targetEmail = (res.email || email).trim().toLowerCase();
        setPendingVerifyEmail(targetEmail);
        setVerificationCode('');
        setAuthTab('verify_email');
        setNoticeMessage(
          res.message ||
            `We sent a 6-digit verification code to ${targetEmail}. Enter it below to verify your email and activate your affiliate account.`
        );
        return;
      }

      onAuthSuccess({
        token: res.token,
        user: res.user,
        affiliate: res.affiliate,
      });
      if (res.affiliate) {
        setPortalAffiliate(res.affiliate);
      }
      setNoticeMessage('Welcome! Your Affiliate Partner account is now active.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setNoticeMessage('');
    const targetEmail = pendingVerifyEmail.trim().toLowerCase();
    const cleanCode = verificationCode.trim();
    if (!targetEmail || cleanCode.length < 4) {
      setErrorMessage('Please enter both your email address and the 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.authVerifyEmail(targetEmail, cleanCode);
      onAuthSuccess({
        token: res.token,
        user: res.user,
        affiliate: res.affiliate,
      });
      if (res.affiliate) {
        setPortalAffiliate(res.affiliate);
      }
      setVerificationCode('');
      setNoticeMessage(res.message || 'Email verified and Affiliate Partner account activated!');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = pendingVerifyEmail.trim().toLowerCase();
    if (!targetEmail) {
      setErrorMessage('Please provide your registered email address first.');
      return;
    }
    setIsResendingCode(true);
    setErrorMessage('');
    setNoticeMessage('');
    try {
      const res = await api.authResendVerification(targetEmail);
      setNoticeMessage(res.message || `A fresh verification code has been sent to ${targetEmail}.`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not resend verification code.');
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setNoticeMessage('');
    const clean = forgotEmail.trim().toLowerCase();
    if (!clean) {
      setErrorMessage('Please enter your account email address.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.authForgotPassword(clean);
      setResetEmail(clean);
      setResetCodeOrToken('');
      setNewPassword('');
      setConfirmNewPassword('');
      setAuthTab('reset_password');
      setNoticeMessage(
        res.message ||
          `If an account exists for ${clean}, a 6-digit reset code and secure link have been emailed.`
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not send reset email.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setNoticeMessage('');
    const cleanEmail = resetEmail.trim().toLowerCase();
    const cleanToken = resetCodeOrToken.trim();

    if (!cleanEmail) {
      setErrorMessage('Please enter your account email address.');
      return;
    }
    if (!cleanToken) {
      setErrorMessage('Please enter your 6-digit reset code or use the link from your email.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('New password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const isShortCode = /^\d{4,8}$/.test(cleanToken);
      const res = await api.authResetPassword({
        email: cleanEmail,
        ...(isShortCode ? { code: cleanToken } : { token: cleanToken }),
        newPassword,
        confirmPassword: confirmNewPassword,
      });
      setNewPassword('');
      setConfirmNewPassword('');
      setResetCodeOrToken('');
      setLoginEmail(cleanEmail);
      setAuthTab('login');
      setNoticeMessage(res.message || 'Password updated successfully. You can now sign in.');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBecomeAffiliate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) return;
    setErrorMessage('');
    setNoticeMessage('');
    setIsSubmitting(true);
    try {
      const res = await api.becomeAffiliate(authToken, {
        bankName: becomeBankName.trim(),
        accountNumber: becomeAccountNumber.trim(),
        accountName: becomeAccountName.trim(),
      });
      onAuthSuccess({
        token: res.token,
        user: res.user,
        affiliate: res.affiliate,
      });
      setPortalAffiliate(res.affiliate);
      setNoticeMessage('Your Affiliate Partner profile is now active!');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not activate affiliate profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken) return;
    setErrorMessage('');
    setNoticeMessage('');
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      setErrorMessage('Enter a valid withdrawal amount.');
      return;
    }
    setIsSubmitting(true);
    try {
      await api.requestAffiliateWithdrawal(authToken, amt);
      setWithdrawAmount('');
      setNoticeMessage('Withdrawal request submitted successfully.');
      await loadAffiliatePortal(authToken);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to submit withdrawal request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyReferralLink = (code: string) => {
    const link = `${window.location.origin}/?ref=${code}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const openWhatsAppApproval = (aff: Affiliate) => {
    const cleanNum = (settings.internationalWhatsApp || '2347045200361').replace(/\D/g, '');
    const msg = `Hello Zeek Softwares Admin, I registered as an Affiliate!\n\nName: ${aff.fullName}\nEmail: ${aff.email}\nReferral Code: ${aff.referralCode}\nUser ID: ${aff.userId}\nBank: ${aff.bankName} (${aff.accountNumber} - ${aff.accountName})`;
    window.open(`https://wa.me/${cleanNum}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const getModalHeading = () => {
    if (authToken && authUser) {
      return `Welcome, ${authUser.fullName || authUser.name || authUser.email}`;
    }
    if (authTab === 'login') return 'Sign In to Your Account';
    if (authTab === 'verify_email') return 'Verify Your Email Address';
    if (authTab === 'forgot_password') return 'Forgot Password?';
    if (authTab === 'reset_password') return 'Set a New Password';
    return settings.affiliateGuide?.registerTitle?.trim() || 'Become Affiliate';
  };

  const getModalSubtitle = () => {
    if (authToken && authUser) {
      return 'Unified account access for affiliate partners and verified administrators.';
    }
    if (authTab === 'login') {
      return 'General sign in for all Zeek Softwares affiliates and verified admins.';
    }
    if (authTab === 'verify_email') {
      return 'Confirm ownership of your email address to unlock your affiliate dashboard.';
    }
    if (authTab === 'forgot_password') {
      return 'Enter your account email and we will send you a time-limited reset code and link.';
    }
    if (authTab === 'reset_password') {
      return 'Choose a new password for your Zeek Softwares account.';
    }
    return (
      settings.affiliateGuide?.registerSubtitle?.trim() ||
      'Join the Zeek Softwares Affiliate Programme and earn commissions on eligible referrals.'
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 pb-24 sm:pb-6 overflow-y-auto">
        <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden relative my-6 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="bg-[#061B45] text-white p-6 relative">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-5 right-5 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#FF7900] mb-2">
              <Sparkles className="w-4 h-4 text-[#FF7900]" />
              <span>Zeek Softwares Account</span>
            </div>

            <h3 className="text-2xl font-black tracking-tight text-white">
              {getModalHeading()}
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-md">{getModalSubtitle()}</p>

            {!authToken && (
              <div className="flex flex-wrap items-center gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setNoticeMessage('');
                    setAuthTab('login');
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    authTab === 'login'
                      ? 'bg-[#FF7900] text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage('');
                    setNoticeMessage('');
                    setAuthTab('register');
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    authTab === 'register'
                      ? 'bg-[#FF7900] text-white'
                      : 'bg-white/10 text-slate-200 hover:bg-white/20'
                  }`}
                >
                  Become Affiliate
                </button>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                {errorMessage}
              </div>
            )}
            {noticeMessage && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                {noticeMessage}
              </div>
            )}

            {/* SIGNED IN VIEW */}
            {authToken && authUser ? (
              <div className="space-y-5">
                {/* Account Summary Card */}
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-[#061B45]">
                        {authUser.fullName || authUser.name}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#061B45] text-white text-[10px] font-bold uppercase">
                        {authUser.role}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                        {authUser.status}
                      </span>
                      {authUser.isVerified && (
                        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold uppercase">
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-mono">{authUser.email}</p>
                    <p className="text-[10px] text-slate-400 font-mono">User _id: {authUser._id}</p>
                  </div>

                  <button
                    type="button"
                    onClick={onLogout}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>

                {/* ADMIN ROLE ACTION */}
                {authUser.role === 'admin' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-[#061B45] flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-[#FF7900]" />
                        <span>Administrator Access Verified</span>
                      </h4>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Manage products, orders, users, affiliates, and site settings.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAdminDashboard();
                      }}
                      className="btn-zeek-orange px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shrink-0"
                    >
                      <span>Open Admin</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* AFFILIATE ROLE PORTAL */}
                {authUser.role === 'affiliate' && (
                  portalLoading || !portalAffiliate ? (
                    <div className="py-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[#FF7900]" />
                      <span>Loading your affiliate earnings dashboard...</span>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Launch Full Affiliate Dashboard & Analytics */}
                      <button
                        type="button"
                        onClick={() => setShowFullDashboard(true)}
                        className="w-full py-3 px-4 rounded-2xl bg-[#061B45] hover:bg-[#0c2a63] text-white text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-colors"
                      >
                        <BarChart3 className="w-4 h-4 text-[#FF9200]" />
                        <span>Open Full Affiliate Dashboard (Analytics, Ledger & History)</span>
                      </button>

                      {/* Referral Link */}
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase text-slate-600">
                            Your Personal Storewide Referral Link ({portalAffiliate.referralCode})
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-slate-300">
                          <span className="text-xs font-mono font-bold text-[#061B45] truncate">
                            {window.location.origin}/?ref={portalAffiliate.referralCode}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyReferralLink(portalAffiliate.referralCode)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#061B45] hover:bg-[#0c2a63] text-white text-[11px] font-bold flex items-center gap-1 transition-colors shrink-0"
                            title="Copy Link"
                          >
                            {copied ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-[#FF7900]" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          One link works for every product in the store and tracks your referred customers across repeat visits.
                        </p>
                      </div>

                      {/* Metrics */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Wallet Balance
                          </span>
                          <span className="text-sm font-black text-emerald-700 tabular-nums">
                            ₦{portalAffiliate.availableBalance.toLocaleString('en-NG')}
                          </span>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Total Earned
                          </span>
                          <span className="text-sm font-black text-[#061B45] tabular-nums">
                            ₦{portalAffiliate.totalEarned.toLocaleString('en-NG')}
                          </span>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Clicks / Sales
                          </span>
                          <span className="text-sm font-black text-[#FF7900] tabular-nums">
                            {portalAffiliate.totalClicks} / {portalAffiliate.totalReferredSalesCount}
                          </span>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">
                            Referred Users
                          </span>
                          <span className="text-sm font-black text-[#061B45] tabular-nums">
                            {portalReferredCustomers.length}
                          </span>
                        </div>
                      </div>

                      {onOpenAffiliateGuide && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenAffiliateGuide();
                          }}
                          className="w-full py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#061B45] text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-[#FF7900]" />
                          <span>
                            {settings.affiliateGuide?.buttonText || 'How to Earn From Our Affiliate'}
                          </span>
                        </button>
                      )}

                      {/* Request Payout */}
                      <form
                        onSubmit={handleRequestWithdrawal}
                        className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2"
                      >
                        <label className="text-[11px] font-bold uppercase text-[#061B45] flex items-center gap-1.5">
                          <Wallet className="w-3.5 h-3.5 text-[#FF7900]" />
                          <span>
                            Request Payout (Min ₦
                            {(settings.minWithdrawalAmount || 100).toLocaleString('en-NG')})
                          </span>
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            name="withdrawAmount"
                            autoComplete="off"
                            min={settings.minWithdrawalAmount || 100}
                            value={withdrawAmount}
                            onChange={(e) => setWithdrawAmount(e.target.value)}
                            placeholder="Amount in NGN"
                            className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white tabular-nums"
                          />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-zeek-orange px-4 py-2 rounded-xl text-xs font-bold uppercase disabled:opacity-50"
                          >
                            Withdraw
                          </button>
                        </div>
                      </form>

                      {/* Recent Commissions & Withdrawals */}
                      <div className="text-xs space-y-1.5 max-h-36 overflow-y-auto">
                        <span className="text-[10px] font-bold uppercase text-slate-500 block">
                          Recent Commissions ({portalCommissions.length}) & Withdrawals (
                          {portalWithdrawals.length})
                        </span>
                        {portalWithdrawals.map((w) => (
                          <div
                            key={w.id}
                            className="flex justify-between p-2 rounded-lg bg-slate-50 border border-slate-200"
                          >
                            <span className="font-mono text-[11px]">{w.id}</span>
                            <span className="font-bold tabular-nums">
                              ₦{w.amount.toLocaleString('en-NG')}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-600">
                              {w.status}
                            </span>
                          </div>
                        ))}
                        {portalCommissions.map((c) => (
                          <div
                            key={c.id}
                            className="flex justify-between p-2 rounded-lg bg-emerald-50/50 border border-emerald-100"
                          >
                            <span>{c.productName}</span>
                            <span className="font-bold text-emerald-700 tabular-nums">
                              +₦{c.commissionAmount.toLocaleString('en-NG')}
                            </span>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => openWhatsAppApproval(portalAffiliate)}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Contact Admin on WhatsApp</span>
                      </button>
                    </div>
                  )
                )}

                {/* LEGACY/INACTIVE 'user' ROLE: CAN ACTIVATE AFFILIATE PROFILE */}
                {authUser.role === 'user' && (
                  <form
                    onSubmit={handleBecomeAffiliate}
                    className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3"
                  >
                    <div>
                      <h4 className="text-xs font-black text-[#061B45] uppercase tracking-wider">
                        Become Affiliate
                      </h4>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Link your Nigerian bank account below to activate your Affiliate Partner profile (User _id: {authUser._id}).
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input
                        type="text"
                        name="bankName"
                        autoComplete="on"
                        required
                        value={becomeBankName}
                        onChange={(e) => setBecomeBankName(e.target.value)}
                        placeholder="Bank Name *"
                        className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      />
                      <input
                        type="text"
                        name="accountNumber"
                        autoComplete="on"
                        required
                        value={becomeAccountNumber}
                        onChange={(e) => setBecomeAccountNumber(e.target.value)}
                        placeholder="Account Number *"
                        className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      />
                      <input
                        type="text"
                        name="accountName"
                        autoComplete="name"
                        required
                        value={becomeAccountName}
                        onChange={(e) => setBecomeAccountName(e.target.value)}
                        placeholder="Account Name *"
                        className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="btn-zeek-orange w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                    >
                      {isSubmitting ? 'Activating...' : 'Become Affiliate'}
                    </button>
                  </form>
                )}
              </div>
            ) : authTab === 'verify_email' ? (
              /* AFFILIATE EMAIL VERIFICATION CODE VIEW */
              <form onSubmit={handleVerifyEmailSubmit} className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                  <div className="flex items-center gap-2 text-[#061B45] font-extrabold uppercase text-[11px]">
                    <ShieldCheck className="w-4 h-4 text-[#FF7900]" />
                    <span>Email Ownership Verification Required</span>
                  </div>
                  <p>
                    Enter the 6-digit verification code sent to{' '}
                    <strong className="text-[#061B45]">{pendingVerifyEmail || 'your email'}</strong>{' '}
                    to verify ownership and unlock your affiliate dashboard.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Registered Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={pendingVerifyEmail}
                    onChange={(e) => setPendingVerifyEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    6-Digit Verification Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={8}
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\s+/g, ''))}
                    placeholder="e.g. 482910"
                    className="w-full px-3.5 py-3 text-center text-lg tracking-[0.35em] font-mono font-black rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-zeek-orange w-full py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Verifying Code...' : 'Verify & Activate Affiliate Account'}
                </button>

                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <button
                    type="button"
                    disabled={isResendingCode}
                    onClick={handleResendVerification}
                    className="font-bold text-[#061B45] hover:text-[#FF7900] inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isResendingCode ? 'animate-spin' : ''}`} />
                    <span>{isResendingCode ? 'Sending...' : 'Resend Verification Code'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage('');
                      setNoticeMessage('');
                      setAuthTab('login');
                    }}
                    className="text-slate-500 hover:text-[#061B45] underline"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            ) : authTab === 'forgot_password' ? (
              /* FORGOT PASSWORD VIEW */
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
                  <div className="flex items-center gap-2 text-[#061B45] font-extrabold uppercase text-[11px]">
                    <KeyRound className="w-4 h-4 text-[#FF7900]" />
                    <span>Reset Your Password</span>
                  </div>
                  <p>
                    Enter your registered account email address. We will send both a 6-digit
                    reset code and a direct one-time reset link valid for 30 minutes.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Account Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-zeek-orange w-full py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Sending Reset Link...' : 'Send Reset Code & Link'}
                </button>

                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setResetEmail(forgotEmail);
                      setAuthTab('reset_password');
                      setErrorMessage('');
                      setNoticeMessage('');
                    }}
                    className="text-[#061B45] font-bold hover:underline"
                  >
                    Already have a reset code?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setErrorMessage('');
                      setNoticeMessage('');
                    }}
                    className="text-slate-500 hover:text-[#061B45] underline"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            ) : authTab === 'reset_password' ? (
              /* RESET PASSWORD VIEW */
              <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Account Email Address <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2.5 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>

                {initialResetToken && resetCodeOrToken === initialResetToken && initialResetToken.length > 8 ? (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      Secure reset link token applied from your email.
                    </span>
                    <button
                      type="button"
                      onClick={() => setResetCodeOrToken('')}
                      className="text-[11px] font-bold underline shrink-0"
                    >
                      Enter 6-digit code instead
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      6-Digit Reset Code (or Link Token) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      autoComplete="one-time-code"
                      required
                      value={resetCodeOrToken}
                      onChange={(e) => setResetCodeOrToken(e.target.value.trim())}
                      placeholder="Enter 6-digit code from your email"
                      className="w-full px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    New Password (min 6 chars) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      name="newPassword"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter your new password"
                      className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                      aria-pressed={showNewPassword}
                      title={showNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-[#061B45] hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FF7900]/50 transition-colors touch-manipulation"
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Confirm New Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmNewPassword ? 'text' : 'password'}
                      name="confirmPassword"
                      autoComplete="new-password"
                      required
                      minLength={6}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Re-enter your new password"
                      className="w-full pl-3 pr-10 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmNewPassword((prev) => !prev)}
                      aria-label={showConfirmNewPassword ? 'Hide confirm password' : 'Show confirm password'}
                      aria-pressed={showConfirmNewPassword}
                      title={showConfirmNewPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-[#061B45] hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FF7900]/50 transition-colors touch-manipulation"
                    >
                      {showConfirmNewPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-zeek-orange w-full py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Updating Password...' : 'Save New Password'}
                </button>

                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(resetEmail);
                      setAuthTab('forgot_password');
                      setErrorMessage('');
                      setNoticeMessage('');
                    }}
                    className="text-[#061B45] font-bold hover:underline"
                  >
                    Request a new reset code
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('login');
                      setErrorMessage('');
                      setNoticeMessage('');
                    }}
                    className="text-slate-500 hover:text-[#061B45] underline"
                  >
                    Back to Sign In
                  </button>
                </div>
              </form>
            ) : authTab === 'login' ? (
              /* GENERAL LOGIN FORM */
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                {!useMasterKey && (
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        name="email"
                        autoComplete="email"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      {useMasterKey ? 'Master Secret Key (.env)' : 'Password'}{' '}
                      <span className="text-red-500">*</span>
                    </label>
                    {!useMasterKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotEmail(loginEmail);
                          setErrorMessage('');
                          setNoticeMessage('');
                          setAuthTab('forgot_password');
                        }}
                        className="text-[11px] font-bold text-[#FF7900] hover:underline"
                      >
                        Forgot Password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    {useMasterKey ? (
                      <Key className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    ) : (
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    )}
                    <input
                      type={showLoginPassword ? 'text' : 'password'}
                      name={useMasterKey ? 'adminKey' : 'password'}
                      autoComplete={useMasterKey ? 'off' : 'current-password'}
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={
                        useMasterKey
                          ? 'Enter ADMIN_SECRET_KEY from .env...'
                          : 'Enter your account password'
                      }
                      className="w-full pl-9 pr-10 py-2.5 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword((prev) => !prev)}
                      aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showLoginPassword}
                      title={showLoginPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-[#061B45] hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FF7900]/50 transition-colors touch-manipulation"
                    >
                      {showLoginPassword ? (
                        <EyeOff className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Eye className="w-4 h-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-zeek-orange w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50"
                >
                  {isSubmitting ? 'Signing In...' : 'Sign In'}
                </button>

                <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                  <button
                    type="button"
                    onClick={() => {
                      setUseMasterKey(!useMasterKey);
                      setErrorMessage('');
                    }}
                    className="hover:text-[#061B45] underline"
                  >
                    {useMasterKey ? 'Sign in with Email & Password' : 'Admin Master Key (.env)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('register');
                      setErrorMessage('');
                    }}
                    className="font-bold text-[#FF7900] hover:underline"
                  >
                    New partner? Become Affiliate
                  </button>
                </div>
              </form>
            ) : (
              /* GENERAL REGISTRATION FORM (BECOME AFFILIATE - DEFAULT ROLE: AFFILIATE) */
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                    <TrendingUp className="w-4 h-4 text-[#FF7900] mx-auto mb-0.5" />
                    <span className="block text-xs font-extrabold text-[#061B45]">
                      {(settings.defaultCommissionRate ?? 0) > 0
                        ? `${settings.defaultCommissionRate}% Base`
                        : 'Per-Product'}
                    </span>
                    <span className="text-[10px] text-slate-500">Commission</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                    <DollarSign className="w-4 h-4 text-emerald-600 mx-auto mb-0.5" />
                    <span className="block text-xs font-extrabold text-[#061B45] tabular-nums">
                      ₦{(settings.minWithdrawalAmount ?? 100).toLocaleString('en-NG')} Min
                    </span>
                    <span className="text-[10px] text-slate-500">Bank Payout</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
                    <ShieldCheck className="w-4 h-4 text-blue-600 mx-auto mb-0.5" />
                    <span className="block text-xs font-extrabold text-[#061B45]">
                      Email Verified
                    </span>
                    <span className="text-[10px] text-slate-500">Instant Activation</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Full Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      name="name"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Babatunde Adeyemi"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      name="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      WhatsApp / Phone <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="tel"
                      name="tel"
                      autoComplete="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+234 812 345 6789"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Password (min 6 chars) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showRegisterPassword ? 'text' : 'password'}
                        name="newPassword"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create a strong password"
                        className="w-full pl-3 pr-10 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword((prev) => !prev)}
                        aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showRegisterPassword}
                        title={showRegisterPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-[#061B45] hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#FF7900]/50 transition-colors touch-manipulation"
                      >
                        {showRegisterPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-3">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#061B45] block mb-2">
                    Payout Bank Account Details <span className="text-red-500">*</span>
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      name="bankName"
                      autoComplete="on"
                      required
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="Bank Name (OPay / GTBank)"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                    <input
                      type="text"
                      name="accountNumber"
                      autoComplete="on"
                      required
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="Account Number"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                    <input
                      type="text"
                      name="accountName"
                      autoComplete="name"
                      required
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Account Name"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                    />
                  </div>
                </div>

                <label className="flex items-start gap-2 text-[11px] text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marketingConsent}
                    onChange={(e) => setMarketingConsent(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded text-[#FF7900] focus:ring-[#FF7900]"
                  />
                  <span>
                    Send me partner tips, campaign updates, and promotional announcements via email (optional).
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-zeek-orange w-full py-3 rounded-xl text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? 'Creating Account...' : 'Become Affiliate'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Full Affiliate Dashboard Overlay */}
      {showFullDashboard && authToken && authUser?.role === 'affiliate' && (
        <AffiliateDashboardView
          mode="affiliate"
          token={authToken}
          settings={settings}
          onOpenAffiliateGuide={onOpenAffiliateGuide}
          onClose={() => {
            setShowFullDashboard(false);
            if (authToken) loadAffiliatePortal(authToken);
          }}
        />
      )}
    </>
  );
};

