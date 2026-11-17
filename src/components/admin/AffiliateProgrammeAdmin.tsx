import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  BookOpen,
  Calendar,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Copy,
  Eye,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  Percent,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  AdminAffiliateAnalytics,
  Affiliate,
  AffiliateGuideConfig,
  AffiliateGuideSection,
  AffiliateHighlightItem,
  AffiliateWithdrawal,
  DatePeriodFilter,
  LegalPolicies,
  PayoutFilter,
  Product,
  ReferralAttribution,
  SiteSettings,
} from '../../types';
import { api } from '../../api/client';
import { AffiliateDashboardView } from '../AffiliateDashboardView';

interface AffiliateProgrammeAdminProps {
  settings: SiteSettings;
  setSettings: React.Dispatch<React.SetStateAction<SiteSettings | null>>;
  policies?: LegalPolicies | null;
  setPolicies?: React.Dispatch<React.SetStateAction<LegalPolicies | null>>;
  onSavePolicies?: () => Promise<void>;
  products: Product[];
  affiliates: Affiliate[];
  referredCustomers: ReferralAttribution[];
  withdrawals: AffiliateWithdrawal[];
  token: string;
  uploadAssetFile: (file: File) => Promise<string>;
  onRefreshPublicData: () => void;
  loadAdminData: () => Promise<void>;
  setSaveSuccessMsg: (msg: string) => void;
  setSaveErrorMsg: (msg: string) => void;
  handleWithdrawalStatus: (
    withdrawalId: string,
    status: AffiliateWithdrawal['status'],
    extra?: { rejectionReason?: string; transferReference?: string; adminNotes?: string }
  ) => Promise<void>;
}

const DEFAULT_HIGHLIGHTS: AffiliateHighlightItem[] = [
  {
    label: 'Storewide Link',
    value: '1 Unique Link',
    subtitle: 'Tracks referrals across every product',
  },
  {
    label: 'Minimum Payout',
    value: '₦100',
    subtitle: 'Direct Nigerian bank payout',
  },
  {
    label: 'Commission Structure',
    value: 'Admin Configured',
    subtitle: 'Product rates configurable by Admin',
  },
  {
    label: 'Partner Dashboard',
    value: 'Live Tracking',
    subtitle: 'Monitor clicks, sales & earnings',
  },
];

const DEFAULT_GUIDE: AffiliateGuideConfig = {
  buttonText: 'How to Earn From Our Affiliate',
  title: 'How to Earn From Our Affiliate Programme',
  description:
    'Follow these straightforward steps to join Zeek Softwares, share your personal referral link, and receive commissions on eligible purchases.',
  heroImageUrl: '',
  promoEyebrow: 'Zeek Softwares Affiliate Programme',
  promoHeadline: 'Share One Personal Link. Earn Across Every Product.',
  promoDescription:
    'Partner with Zeek Softwares and earn commissions when customers purchase AI tools and software plans through your unique referral link.',
  registerTitle: 'Become Affiliate',
  registerSubtitle:
    'Join the Zeek Softwares Affiliate Programme and earn commissions on eligible referrals.',
  highlightCards: DEFAULT_HIGHLIGHTS,
  ctaBannerTitle: 'Ready to Start Earning With Zeek Softwares?',
  ctaBannerDescription:
    'Registration is free and takes under two minutes. Get your unique personal affiliate link and earn across every software subscription in our store.',
  sections: [],
};

export const AffiliateProgrammeAdmin: React.FC<AffiliateProgrammeAdminProps> = ({
  settings,
  setSettings,
  policies,
  setPolicies,
  onSavePolicies,
  products,
  affiliates,
  referredCustomers,
  withdrawals,
  token,
  uploadAssetFile,
  onRefreshPublicData,
  loadAdminData,
  setSaveSuccessMsg,
  setSaveErrorMsg,
  handleWithdrawalStatus,
}) => {
  const [subTab, setSubTab] = useState<'commissions' | 'guide' | 'partners'>('partners');
  const [productSearch, setProductSearch] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Admin Affiliate Financial Analytics & Filters
  const [analytics, setAnalytics] = useState<AdminAffiliateAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [period, setPeriod] = useState<DatePeriodFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>('all');
  const [inspectingAffiliateId, setInspectingAffiliateId] = useState<string | null>(null);
  const [declineModal, setDeclineModal] = useState<{
    withdrawal: AffiliateWithdrawal;
    reason: string;
    error: string;
  } | null>(null);
  const [markPaidModal, setMarkPaidModal] = useState<{
    withdrawal: AffiliateWithdrawal;
    transferReference: string;
    adminNotes: string;
  } | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // Commission & Rule Draft State
  const [defaultRate, setDefaultRate] = useState<number>(settings.defaultCommissionRate ?? 0);
  const [minWithdrawal, setMinWithdrawal] = useState<number>(settings.minWithdrawalAmount ?? 100);
  const [cookieDays, setCookieDays] = useState<number>(settings.referralCookieDays ?? 30);
  const [productRateDrafts, setProductRateDrafts] = useState<Record<string, string>>({});
  const [isSavingRecurring, setIsSavingRecurring] = useState(false);
  const [isSavingCommissions, setIsSavingCommissions] = useState(false);

  // Affiliate Guide CMS Draft State
  const [guideDraft, setGuideDraft] = useState<AffiliateGuideConfig>(
    settings.affiliateGuide || DEFAULT_GUIDE
  );
  const [isSavingGuide, setIsSavingGuide] = useState(false);
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);

  const loadAnalytics = async (
    nextPeriod: DatePeriodFilter = period,
    nextFrom: string = customFrom,
    nextTo: string = customTo,
    nextPayout: PayoutFilter = payoutFilter
  ) => {
    if (!token) return;
    setAnalyticsLoading(true);
    try {
      const res = await api.getAdminAffiliateAnalytics(token, {
        period: nextPeriod,
        ...(nextPeriod === 'custom' && nextFrom ? { from: nextFrom } : {}),
        ...(nextPeriod === 'custom' && nextTo ? { to: nextTo } : {}),
        payoutFilter: nextPayout,
      });
      setAnalytics(res);
    } catch (err: unknown) {
      setSaveErrorMsg(err instanceof Error ? err.message : 'Failed to load affiliate analytics.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics(period, customFrom, customTo, payoutFilter);
  }, [token, withdrawals.length, affiliates.length]);

  // Keep drafts synchronized when settings/products reload
  useEffect(() => {
    setDefaultRate(settings.defaultCommissionRate ?? 0);
    setMinWithdrawal(settings.minWithdrawalAmount ?? 100);
    setCookieDays(settings.referralCookieDays ?? 30);

    const mapDrafts: Record<string, string> = {};
    const settingsRates = settings.productCommissionRates || {};
    products.forEach((p) => {
      const effectiveOverride =
        typeof p.commissionRateOverride === 'number'
          ? p.commissionRateOverride
          : typeof settingsRates[p.id] === 'number'
          ? settingsRates[p.id]
          : undefined;
      mapDrafts[p.id] =
        typeof effectiveOverride === 'number' && !Number.isNaN(effectiveOverride)
          ? String(effectiveOverride)
          : '';
    });
    setProductRateDrafts(mapDrafts);
  }, [settings, products]);

  useEffect(() => {
    if (settings.affiliateGuide) {
      setGuideDraft({
        buttonText: settings.affiliateGuide.buttonText || DEFAULT_GUIDE.buttonText,
        title: settings.affiliateGuide.title || DEFAULT_GUIDE.title,
        description: settings.affiliateGuide.description || DEFAULT_GUIDE.description,
        heroImageUrl: settings.affiliateGuide.heroImageUrl || '',
        promoEyebrow: settings.affiliateGuide.promoEyebrow || DEFAULT_GUIDE.promoEyebrow,
        promoHeadline: settings.affiliateGuide.promoHeadline || DEFAULT_GUIDE.promoHeadline,
        promoDescription: settings.affiliateGuide.promoDescription || '',
        registerTitle: settings.affiliateGuide.registerTitle || DEFAULT_GUIDE.registerTitle,
        registerSubtitle: settings.affiliateGuide.registerSubtitle || DEFAULT_GUIDE.registerSubtitle,
        highlightCards:
          settings.affiliateGuide.highlightCards && settings.affiliateGuide.highlightCards.length > 0
            ? settings.affiliateGuide.highlightCards
            : DEFAULT_HIGHLIGHTS,
        ctaBannerTitle: settings.affiliateGuide.ctaBannerTitle || DEFAULT_GUIDE.ctaBannerTitle,
        ctaBannerDescription:
          settings.affiliateGuide.ctaBannerDescription || DEFAULT_GUIDE.ctaBannerDescription,
        sections: (settings.affiliateGuide.sections || []).map((s, idx) => ({
          ...s,
          displayOrder: s.displayOrder || idx + 1,
        })),
      });
    }
  }, [settings.affiliateGuide]);

  const handleToggleRecurring = async (nextValue: boolean) => {
    if (!token || isSavingRecurring) return;
    setIsSavingRecurring(true);
    setSaveErrorMsg('');
    setSaveSuccessMsg('');
    try {
      const updated = await api.updateSettings(token, {
        recurringCommissionsEnabled: nextValue,
      });
      setSettings(updated);
      onRefreshPublicData();
      setSaveSuccessMsg(
        `Recurring affiliate commissions turned ${nextValue ? 'ON (All subsequent referred orders earn commission)' : 'OFF (First qualifying purchase only)'}.`
      );
    } catch (err: unknown) {
      setSaveErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingRecurring(false);
    }
  };

  const handleSaveCommissions = async () => {
    if (!token) return;
    setIsSavingCommissions(true);
    setSaveErrorMsg('');
    setSaveSuccessMsg('');

    try {
      const parsedDefault = Number(defaultRate);
      if (Number.isNaN(parsedDefault) || parsedDefault < 0 || parsedDefault > 100) {
        throw new Error('Default commission rate must be between 0% and 100%.');
      }

      const nextRates: Record<string, number> = {};
      for (const p of products) {
        const raw = (productRateDrafts[p.id] ?? '').trim();
        if (raw !== '') {
          const val = Number(raw);
          if (Number.isNaN(val) || val < 0 || val > 100) {
            throw new Error(`Invalid commission rate for "${p.name}". Must be between 0 and 100.`);
          }
          nextRates[p.id] = val;
        }
      }

      const updated = await api.updateSettings(token, {
        defaultCommissionRate: parsedDefault,
        minWithdrawalAmount: Math.max(0, Number(minWithdrawal) || 100),
        referralCookieDays: Math.max(1, Number(cookieDays) || 30),
        productCommissionRates: nextRates,
      });
      setSettings(updated);
      await loadAdminData();
      onRefreshPublicData();
      setSaveSuccessMsg(
        'Affiliate commission rates saved. New rates apply to future eligible orders without altering past earned commissions.'
      );
    } catch (err: unknown) {
      setSaveErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingCommissions(false);
    }
  };

  const handleSaveGuide = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!token) return;
    setIsSavingGuide(true);
    setSaveErrorMsg('');
    setSaveSuccessMsg('');

    try {
      const normalizedSections: AffiliateGuideSection[] = guideDraft.sections.map((sec, idx) => ({
        id: sec.id || `step-${Date.now()}-${idx}`,
        stepNumber: (sec.stepNumber || String(idx + 1).padStart(2, '0')).trim(),
        title: sec.title.trim() || `Step ${idx + 1}`,
        content: sec.content.trim() || 'Add instructional content...',
        imageUrl: sec.imageUrl?.trim() || '',
        linkLabel: sec.linkLabel?.trim() || '',
        linkUrl: sec.linkUrl?.trim() || '',
        displayOrder: idx + 1,
      }));

      const payload: AffiliateGuideConfig = {
        buttonText: guideDraft.buttonText.trim() || DEFAULT_GUIDE.buttonText,
        title: guideDraft.title.trim() || DEFAULT_GUIDE.title,
        description: guideDraft.description.trim() || DEFAULT_GUIDE.description,
        heroImageUrl: guideDraft.heroImageUrl?.trim() || '',
        promoEyebrow: guideDraft.promoEyebrow?.trim() || DEFAULT_GUIDE.promoEyebrow,
        promoHeadline: guideDraft.promoHeadline?.trim() || DEFAULT_GUIDE.promoHeadline,
        promoDescription: guideDraft.promoDescription?.trim() || '',
        registerTitle: guideDraft.registerTitle?.trim() || DEFAULT_GUIDE.registerTitle,
        registerSubtitle: guideDraft.registerSubtitle?.trim() || DEFAULT_GUIDE.registerSubtitle,
        highlightCards: (guideDraft.highlightCards || DEFAULT_HIGHLIGHTS).map((c) => ({
          label: c.label.trim() || 'Highlight',
          value: c.value.trim() || '—',
          subtitle: c.subtitle.trim() || '',
        })),
        ctaBannerTitle: guideDraft.ctaBannerTitle?.trim() || DEFAULT_GUIDE.ctaBannerTitle,
        ctaBannerDescription:
          guideDraft.ctaBannerDescription?.trim() || DEFAULT_GUIDE.ctaBannerDescription,
        sections: normalizedSections,
      };

      const updated = await api.updateSettings(token, { affiliateGuide: payload });
      setSettings(updated);
      if (policies && onSavePolicies) {
        await api.updateCMS(token, 'policies', { policies });
      }
      onRefreshPublicData();
      setSaveSuccessMsg('Affiliate programme content, policies & walkthrough published to live storefront.');
    } catch (err: unknown) {
      setSaveErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingGuide(false);
    }
  };

  const handleUploadGuideImage = async (target: 'hero' | number, file: File) => {
    const key = target === 'hero' ? 'hero' : `section-${target}`;
    setUploadingTarget(key);
    setSaveErrorMsg('');
    try {
      const url = await uploadAssetFile(file);
      if (target === 'hero') {
        setGuideDraft((prev) => ({ ...prev, heroImageUrl: url }));
      } else {
        setGuideDraft((prev) => {
          const next = [...prev.sections];
          if (next[target]) {
            next[target] = { ...next[target], imageUrl: url };
          }
          return { ...prev, sections: next };
        });
      }
      setSaveSuccessMsg(`Uploaded "${file.name}". Remember to save guide changes.`);
    } catch (err: unknown) {
      setSaveErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleAddGuideSection = () => {
    const nextOrder = guideDraft.sections.length + 1;
    setGuideDraft((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: `step-${Date.now()}`,
          stepNumber: String(nextOrder).padStart(2, '0'),
          title: 'New Affiliate Step',
          content: '',
          imageUrl: '',
          linkLabel: '',
          linkUrl: '',
          displayOrder: nextOrder,
        },
      ],
    }));
  };

  const handleMoveGuideSection = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= guideDraft.sections.length) return;
    setGuideDraft((prev) => {
      const list = [...prev.sections];
      const temp = list[idx];
      list[idx] = list[targetIdx];
      list[targetIdx] = temp;
      return {
        ...prev,
        sections: list.map((s, i) => ({ ...s, displayOrder: i + 1 })),
      };
    });
  };

  const handleDeleteGuideSection = (idx: number) => {
    setGuideDraft((prev) => ({
      ...prev,
      sections: prev.sections
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, displayOrder: i + 1 })),
    }));
  };

  const copyAffiliateLink = (code: string) => {
    const url = `${window.location.origin}/?ref=${code}`;
    navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const filteredProducts = products.filter((p) => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
  });

  const recurringEnabled = settings.recurringCommissionsEnabled !== false;

  return (
    <div className="space-y-6">
      {/* Section Header & Sub-tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-black text-[#061B45]">
            Affiliate Programme & Commission Control
          </h3>
          <p className="text-xs text-slate-500">
            Configure per-product commission percentages, recurring commission rules, referral guide CMS, and partner payouts.
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
          {[
            {
              id: 'partners',
              label: `Analytics, Partners & Payouts (${affiliates.length})`,
              icon: TrendingUp,
            },
            { id: 'commissions', label: 'Commission Rates & Recurring', icon: Percent },
            { id: 'guide', label: 'How to Earn Guide CMS', icon: BookOpen },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id as any)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-[#061B45] text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#FF7900]' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUB-TAB 1: COMMISSION RATES & RECURRING PURCHASE CONTROL */}
      {subTab === 'commissions' && (
        <div className="space-y-6">
          {/* 1. Recurring Purchase Commissions ON / OFF Control */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h4 className="text-sm font-black text-[#061B45] uppercase tracking-wider">
                    Recurring Purchase Commissions
                  </h4>
                  <span className="px-2 py-0.5 rounded bg-[#061B45] text-white text-[10px] font-bold uppercase tracking-wider">
                    Admin-Only Confidential
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-extrabold uppercase tracking-wider ${
                      recurringEnabled
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {recurringEnabled ? 'ON — All Eligible Purchases' : 'OFF — First Purchase Only'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                  {recurringEnabled
                    ? 'Option A Active (Confidential Admin Rule): Affiliates earn commission on every qualifying paid order placed by customers they originally referred. Hidden from all public and affiliate pages.'
                    : 'Option B Active (Confidential Admin Rule): Affiliates earn commission ONLY on a referred customer’s first qualifying paid purchase. Repeat orders from already-referred customers are blocked from earning extra commissions. Strictly hidden from clients and affiliates.'}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSavingRecurring}
                  onClick={() => handleToggleRecurring(true)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 border transition-colors ${
                    recurringEnabled
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isSavingRecurring && recurringEnabled ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ToggleRight className="w-4 h-4" />
                  )}
                  <span>ON</span>
                </button>
                <button
                  type="button"
                  disabled={isSavingRecurring}
                  onClick={() => handleToggleRecurring(false)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 border transition-colors ${
                    !recurringEnabled
                      ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isSavingRecurring && !recurringEnabled ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ToggleLeft className="w-4 h-4" />
                  )}
                  <span>OFF</span>
                </button>
              </div>
            </div>
          </div>

          {/* 2. Global Default Commission & Payout Rules */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-[#061B45] uppercase tracking-wider">
                  Default Commission & Per-Product Overrides
                </h4>
                <p className="text-xs text-slate-500">
                  Products without a custom percentage automatically use the Default Commission Rate. Updating rates applies only to future paid purchases and never alters recorded commissions.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingCommissions}
                onClick={handleSaveCommissions}
                className="btn-zeek-orange px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSavingCommissions ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>Save Commission Rules</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Default Commission Rate (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={defaultRate}
                  onChange={(e) => setDefaultRate(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Minimum Withdrawal (₦)
                </label>
                <input
                  type="number"
                  min={0}
                  value={minWithdrawal}
                  onChange={(e) => setMinWithdrawal(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white tabular-nums"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Referral Attribution Window (Days)
                </label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={cookieDays}
                  onChange={(e) => setCookieDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white tabular-nums"
                />
              </div>
            </div>

            {/* Per-Product Commission Rate Matrix */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-700">
                  Individual Product Commission Matrix ({filteredProducts.length})
                </span>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Filter products..."
                    className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs w-56"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Product</th>
                      <th className="p-3">Selling Price</th>
                      <th className="p-3">Effective Rate</th>
                      <th className="p-3">Custom Rate Override (%)</th>
                      <th className="p-3 text-right">Reset</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map((p) => {
                      const draftVal = productRateDrafts[p.id] ?? '';
                      const hasCustom = draftVal.trim() !== '';
                      const effectiveRate = hasCustom ? Number(draftVal) : defaultRate;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50">
                          <td className="p-3">
                            <span className="font-bold text-slate-900 block">{p.name}</span>
                            <span className="text-[10px] text-slate-500">
                              {p.category} • {p.duration}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-bold text-slate-800 tabular-nums">
                            ₦{p.price.toLocaleString('en-NG')}
                            {p.priceSourceCurrency === 'USD' && typeof p.usdPrice === 'number' && (
                              <span className="block text-[10px] text-slate-500 font-normal">
                                Base ${p.usdPrice.toFixed(2)} USD
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold tabular-nums ${
                                hasCustom
                                  ? 'bg-orange-50 text-[#FF7900] border border-orange-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {Number.isNaN(effectiveRate) ? defaultRate : effectiveRate}%{' '}
                              {hasCustom ? 'Custom' : 'Default'}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 max-w-[160px]">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                placeholder={`Default (${defaultRate}%)`}
                                value={draftVal}
                                onChange={(e) =>
                                  setProductRateDrafts((prev) => ({
                                    ...prev,
                                    [p.id]: e.target.value,
                                  }))
                                }
                                className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white tabular-nums"
                              />
                              <span className="text-slate-400 font-bold">%</span>
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {hasCustom && (
                              <button
                                type="button"
                                onClick={() =>
                                  setProductRateDrafts((prev) => ({
                                    ...prev,
                                    [p.id]: '',
                                  }))
                                }
                                className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold inline-flex items-center gap-1"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Default</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: HOW TO EARN GUIDE CMS */}
      {subTab === 'guide' && (
        <form onSubmit={handleSaveGuide} className="space-y-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-[#061B45] uppercase tracking-wider">
                  How to Earn From Our Affiliate — Storefront Button & Header
                </h4>
                <p className="text-xs text-slate-500">
                  Changes made here update the storefront CTA button label, guide title, description, and instructional sections immediately.
                </p>
              </div>
              <button
                type="submit"
                disabled={isSavingGuide}
                className="btn-zeek-orange px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSavingGuide ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>Publish Guide Changes</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Button Text (Visible Across Storefront) *
                </label>
                <input
                  type="text"
                  required
                  value={guideDraft.buttonText}
                  onChange={(e) => setGuideDraft({ ...guideDraft, buttonText: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                  Guide Page Title *
                </label>
                <input
                  type="text"
                  required
                  value={guideDraft.title}
                  onChange={(e) => setGuideDraft({ ...guideDraft, title: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                Guide Intro Description *
              </label>
              <textarea
                rows={3}
                required
                value={guideDraft.description}
                onChange={(e) => setGuideDraft({ ...guideDraft, description: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
              />
            </div>

            {/* Optional Hero Banner Image */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-slate-700 uppercase">
                  Optional Guide Header Banner Image
                </label>
                <div className="flex items-center gap-2">
                  <label className="px-3 py-1.5 rounded-lg bg-[#061B45] hover:bg-[#0c2a63] text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">
                    {uploadingTarget === 'hero' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF7900]" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[#FF7900]" />
                    )}
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadGuideImage('hero', file);
                      }}
                    />
                  </label>
                  {guideDraft.heroImageUrl && (
                    <button
                      type="button"
                      onClick={() => setGuideDraft({ ...guideDraft, heroImageUrl: '' })}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-200 hover:bg-red-100 hover:text-red-700 text-slate-700 text-[11px] font-bold"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-start">
                {guideDraft.heroImageUrl && (
                  <img
                    src={guideDraft.heroImageUrl}
                    alt="Guide banner"
                    referrerPolicy="no-referrer"
                    className="w-32 h-20 object-cover rounded-xl border border-slate-200 shrink-0"
                  />
                )}
                <input
                  type="url"
                  value={guideDraft.heroImageUrl || ''}
                  onChange={(e) => setGuideDraft({ ...guideDraft, heroImageUrl: e.target.value })}
                  placeholder="https://... (or use Upload Image button)"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                />
              </div>
            </div>

            {/* Storefront Promo Banner, Registration Copy & Highlight Cards */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <h5 className="text-xs font-black text-[#061B45] uppercase tracking-wider">
                Storefront Promo Section, Registration Portal & CTA Copy
              </h5>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Homepage Promo Eyebrow
                  </label>
                  <input
                    type="text"
                    value={guideDraft.promoEyebrow || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, promoEyebrow: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Homepage Promo Headline
                  </label>
                  <input
                    type="text"
                    value={guideDraft.promoHeadline || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, promoHeadline: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                  Homepage Promo Description (leave blank to auto-display live payout & rate summary)
                </label>
                <textarea
                  rows={2}
                  value={guideDraft.promoDescription || ''}
                  onChange={(e) => setGuideDraft({ ...guideDraft, promoDescription: e.target.value })}
                  placeholder="Optional custom storefront promo description..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Registration Modal Heading
                  </label>
                  <input
                    type="text"
                    value={guideDraft.registerTitle || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, registerTitle: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Registration Modal Subtitle
                  </label>
                  <input
                    type="text"
                    value={guideDraft.registerSubtitle || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, registerSubtitle: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Guide Bottom CTA Heading
                  </label>
                  <input
                    type="text"
                    value={guideDraft.ctaBannerTitle || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, ctaBannerTitle: e.target.value })}
                    className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                    Guide Bottom CTA Description
                  </label>
                  <input
                    type="text"
                    value={guideDraft.ctaBannerDescription || ''}
                    onChange={(e) => setGuideDraft({ ...guideDraft, ctaBannerDescription: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              </div>

              {/* 4 Highlight Cards Editor */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <span className="text-[10px] font-bold text-slate-600 uppercase block">
                  Storefront & Guide 4 Highlight Stat Cards
                </span>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(guideDraft.highlightCards || DEFAULT_HIGHLIGHTS).slice(0, 4).map((card, cIdx) => (
                    <div key={cIdx} className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                      <span className="text-[10px] font-extrabold text-[#FF7900] uppercase">
                        Card #{cIdx + 1}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={card.label}
                          onChange={(e) => {
                            const list = [...(guideDraft.highlightCards || DEFAULT_HIGHLIGHTS)];
                            list[cIdx] = { ...list[cIdx], label: e.target.value };
                            setGuideDraft({ ...guideDraft, highlightCards: list });
                          }}
                          placeholder="Label"
                          className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300"
                        />
                        <input
                          type="text"
                          value={card.value}
                          onChange={(e) => {
                            const list = [...(guideDraft.highlightCards || DEFAULT_HIGHLIGHTS)];
                            list[cIdx] = { ...list[cIdx], value: e.target.value };
                            setGuideDraft({ ...guideDraft, highlightCards: list });
                          }}
                          placeholder="Headline value"
                          className="px-2.5 py-1.5 text-xs font-bold rounded-lg border border-slate-300"
                        />
                      </div>
                      <input
                        type="text"
                        value={card.subtitle}
                        onChange={(e) => {
                          const list = [...(guideDraft.highlightCards || DEFAULT_HIGHLIGHTS)];
                          list[cIdx] = { ...list[cIdx], subtitle: e.target.value };
                          setGuideDraft({ ...guideDraft, highlightCards: list });
                        }}
                        placeholder="Short description"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Public Affiliate Terms Policy */}
              {policies && setPolicies && (
                <div className="pt-2 border-t border-slate-200 space-y-1">
                  <label className="block text-[10px] font-bold text-slate-600 uppercase">
                    Public Affiliate Terms & Policy (Shown on Policies → Affiliate Terms)
                  </label>
                  <textarea
                    rows={3}
                    value={policies.affiliateTerms || ''}
                    onChange={(e) => setPolicies({ ...policies, affiliateTerms: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Instructional Sections CRUD */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-black text-[#061B45] uppercase tracking-wider">
                  Instructional Content Sections ({guideDraft.sections.length})
                </h4>
                <p className="text-xs text-slate-500">
                  Create, reorder, edit, or delete steps explaining registration, referral links, tracking, commissions, recurring rules, and payouts.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddGuideSection}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-[#061B45] text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Section</span>
              </button>
            </div>

            {guideDraft.sections.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                No instructional sections configured yet. Click "Add Section" to create one.
              </div>
            ) : (
              <div className="space-y-4">
                {guideDraft.sections.map((section, idx) => (
                  <div
                    key={section.id || idx}
                    className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-black text-[#061B45] uppercase tracking-wider">
                        Step #{idx + 1}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveGuideSection(idx, 'up')}
                          className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                          title="Move Up"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === guideDraft.sections.length - 1}
                          onClick={() => handleMoveGuideSection(idx, 'down')}
                          className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                          title="Move Down"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGuideSection(idx)}
                          className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600"
                          title="Delete Section"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Step Label
                        </label>
                        <input
                          type="text"
                          value={section.stepNumber}
                          onChange={(e) => {
                            const updated = [...guideDraft.sections];
                            updated[idx] = { ...section, stepNumber: e.target.value };
                            setGuideDraft({ ...guideDraft, sections: updated });
                          }}
                          className="w-full px-3 py-2 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                          Section Title *
                        </label>
                        <input
                          type="text"
                          required
                          value={section.title}
                          onChange={(e) => {
                            const updated = [...guideDraft.sections];
                            updated[idx] = { ...section, title: e.target.value };
                            setGuideDraft({ ...guideDraft, sections: updated });
                          }}
                          className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-slate-300 bg-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase mb-1">
                        Instructional Content *
                      </label>
                      <textarea
                        rows={3}
                        required
                        value={section.content}
                        onChange={(e) => {
                          const updated = [...guideDraft.sections];
                          updated[idx] = { ...section, content: e.target.value };
                          setGuideDraft({ ...guideDraft, sections: updated });
                        }}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Optional Section Image */}
                      <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                            <ImageIcon className="w-3 h-3" /> Optional Illustration Image
                          </span>
                          <label className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold cursor-pointer inline-flex items-center gap-1">
                            {uploadingTarget === `section-${idx}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            <span>Upload</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleUploadGuideImage(idx, file);
                              }}
                            />
                          </label>
                        </div>
                        <input
                          type="url"
                          value={section.imageUrl || ''}
                          onChange={(e) => {
                            const updated = [...guideDraft.sections];
                            updated[idx] = { ...section, imageUrl: e.target.value };
                            setGuideDraft({ ...guideDraft, sections: updated });
                          }}
                          placeholder="Image URL (optional)"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300"
                        />
                        {section.imageUrl && (
                          <img
                            src={section.imageUrl}
                            alt={section.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-28 object-cover rounded-lg border border-slate-200"
                          />
                        )}
                      </div>

                      {/* Optional Link */}
                      <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-2">
                        <span className="text-[10px] font-bold text-slate-600 uppercase flex items-center gap-1">
                          <LinkIcon className="w-3 h-3" /> Optional Action Link
                        </span>
                        <input
                          type="text"
                          value={section.linkLabel || ''}
                          onChange={(e) => {
                            const updated = [...guideDraft.sections];
                            updated[idx] = { ...section, linkLabel: e.target.value };
                            setGuideDraft({ ...guideDraft, sections: updated });
                          }}
                          placeholder="Link button label (e.g. Open Affiliate Portal)"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300"
                        />
                        <input
                          type="text"
                          value={section.linkUrl || ''}
                          onChange={(e) => {
                            const updated = [...guideDraft.sections];
                            updated[idx] = { ...section, linkUrl: e.target.value };
                            setGuideDraft({ ...guideDraft, sections: updated });
                          }}
                          placeholder="URL (e.g. https://... or /)"
                          className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>
      )}

      {/* SUB-TAB 3: ADMIN AFFILIATE ANALYTICS, PARTNERS & PAYOUTS */}
      {subTab === 'partners' && (
        <div className="space-y-6">
          {/* Period & Payout Filter Bar */}
          <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mr-1">
                  <Calendar className="w-3.5 h-3.5 text-[#FF7900]" />
                  <span>Period Filter:</span>
                </span>
                {(
                  [
                    { id: 'all', label: 'All Time' },
                    { id: 'today', label: 'Today' },
                    { id: 'yesterday', label: 'Past (Yesterday)' },
                    { id: 'weekly', label: 'This Week' },
                    { id: 'monthly', label: 'This Month' },
                    { id: 'custom', label: 'Custom Range' },
                  ] as Array<{ id: DatePeriodFilter; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setPeriod(opt.id);
                      if (opt.id !== 'custom') {
                        loadAnalytics(opt.id, customFrom, customTo, payoutFilter);
                      }
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      period === opt.id
                        ? 'bg-[#061B45] text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={payoutFilter}
                  onChange={(e) => {
                    const next = e.target.value as PayoutFilter;
                    setPayoutFilter(next);
                    loadAnalytics(period, customFrom, customTo, next);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-[#061B45]"
                >
                  <option value="all">Payouts: All Records</option>
                  <option value="upcoming">Payouts: Upcoming / Pending</option>
                  <option value="completed">Payouts: Completed / Paid</option>
                  <option value="previous">Payouts: Previous (Settled & Declined)</option>
                  <option value="declined">Payouts: Declined Only</option>
                </select>
                <button
                  type="button"
                  onClick={() => loadAnalytics(period, customFrom, customTo, payoutFilter)}
                  disabled={analyticsLoading}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#061B45] flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${analyticsLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-500">From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                />
                <span className="text-[11px] font-bold text-slate-500">To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                />
                <button
                  type="button"
                  onClick={() => loadAnalytics('custom', customFrom, customTo, payoutFilter)}
                  className="px-3.5 py-1.5 rounded-lg bg-[#FF7900] text-white text-xs font-bold"
                >
                  Apply Date Range
                </button>
              </div>
            )}
          </div>

          {/* 4 Admin Affiliate Financial Analytics Cards */}
          {analytics?.summary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <span>Total Affiliate Earnings</span>
                  <TrendingUp className="w-4 h-4 text-[#061B45]" />
                </div>
                <div className="text-2xl font-black text-[#061B45] tabular-nums font-mono">
                  ₦{analytics.summary.totalAffiliateEarnings.toLocaleString('en-NG')}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {analytics.summary.totalCommissionsCount} commissions ({period === 'all' ? 'All Time' : period})
                </p>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <span>Total Paid to Affiliates</span>
                  <Banknote className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-black text-emerald-700 tabular-nums font-mono">
                  ₦{analytics.summary.totalAmountPaidToAffiliates.toLocaleString('en-NG')}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {analytics.summary.completedPayoutsCount} completed bank payouts
                </p>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <span>Total Yet to Be Paid</span>
                  <Wallet className="w-4 h-4 text-[#FF7900]" />
                </div>
                <div className="text-2xl font-black text-[#FF7900] tabular-nums font-mono">
                  ₦{analytics.summary.totalYetToBePaid.toLocaleString('en-NG')}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Wallets: ₦{analytics.summary.totalAvailableBalances.toLocaleString('en-NG')} + Pending: ₦{analytics.summary.totalPendingWithdrawalAmount.toLocaleString('en-NG')}
                </p>
              </div>

              <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                  <span>Partner Standing</span>
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-2xl font-black text-blue-700 tabular-nums font-mono">
                  {analytics.summary.totalAffiliatesCount}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">
                  {analytics.summary.activeAffiliatesCount} active •{' '}
                  <strong className="text-amber-700">
                    {analytics.summary.pendingReviewCount} pending payouts
                  </strong>
                </p>
              </div>
            </div>
          )}

          {/* 1. Affiliate Performance & Inspect Dashboard Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                  Affiliate Performance & Individual Dashboards (
                  {analytics?.affiliatePerformance?.length ?? affiliates.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Click "View Dashboard" on any partner to inspect their wallet, commission breakdown, withdrawals, and activity timeline.
                </p>
              </div>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Partner</th>
                  <th className="p-3">Personal Affiliate Link</th>
                  <th className="p-3">Period / All-Time Sales</th>
                  <th className="p-3">Wallet Balance</th>
                  <th className="p-3">Period Earned / Paid</th>
                  <th className="p-3">Bank Details</th>
                  <th className="p-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(analytics?.affiliatePerformance || []).length === 0 && affiliates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-400">
                      No affiliate partners registered yet.
                    </td>
                  </tr>
                ) : (analytics?.affiliatePerformance?.length ? analytics.affiliatePerformance : affiliates.map((aff) => ({
                  affiliateId: aff._id,
                  userId: aff.userId,
                  fullName: aff.fullName,
                  email: aff.email,
                  phone: aff.phone,
                  referralCode: aff.referralCode,
                  isVerified: true,
                  status: 'active' as const,
                  availableBalance: aff.availableBalance,
                  reservedWithdrawalBalance: 0,
                  totalEarned: aff.totalEarned,
                  totalWithdrawn: aff.totalWithdrawn,
                  periodEarnings: aff.totalEarned,
                  periodCommissionsCount: aff.totalReferredSalesCount,
                  periodPaid: aff.totalWithdrawn,
                  periodPendingPayout: 0,
                  periodClicksCount: aff.totalClicks,
                  periodReferralsCount: 0,
                  totalClicks: aff.totalClicks,
                  totalReferredSalesCount: aff.totalReferredSalesCount,
                  bankName: aff.bankName,
                  accountNumber: aff.accountNumber,
                  accountName: aff.accountName,
                  createdAt: aff.createdAt,
                }))).map((row) => (
                  <tr key={row.affiliateId} className="hover:bg-slate-50">
                    <td className="p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-slate-900">{row.fullName}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase ${
                            row.isVerified
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {row.isVerified ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 block font-mono">{row.email}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[#FF7900]">
                          ?ref={row.referralCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyAffiliateLink(row.referralCode)}
                          className="p-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700"
                          title="Copy Personal Affiliate Link"
                        >
                          {copiedCode === row.referralCode ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="p-3 font-mono tabular-nums text-[11px]">
                      <span className="font-bold text-[#061B45] block">
                        {row.periodCommissionsCount} commissions / {row.periodClicksCount} clicks
                      </span>
                      <span className="text-[10px] text-slate-400">
                        All-time: {row.totalReferredSalesCount} sales
                      </span>
                    </td>
                    <td className="p-3 font-bold text-emerald-700 font-mono tabular-nums">
                      ₦{row.availableBalance.toLocaleString('en-NG')}
                      {row.periodPendingPayout > 0 && (
                        <span className="block text-[10px] text-amber-700 font-normal">
                          Pending: ₦{row.periodPendingPayout.toLocaleString('en-NG')}
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono tabular-nums text-[11px]">
                      <span className="font-bold text-[#061B45] block">
                        Earned: ₦{row.periodEarnings.toLocaleString('en-NG')}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Paid: ₦{row.totalWithdrawn.toLocaleString('en-NG')}
                      </span>
                    </td>
                    <td className="p-3 text-[11px] text-slate-600">
                      {row.bankName} • {row.accountNumber} ({row.accountName})
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => setInspectingAffiliateId(row.affiliateId)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#061B45] hover:bg-[#0c2a63] text-white text-[11px] font-bold inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#FF9200]" />
                        <span>View Dashboard</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 2. Withdrawal Requests & Payout Audit */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                  Withdrawal Requests & Payout Records (
                  {(analytics?.withdrawals ?? withdrawals).length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Approving or marking a withdrawal paid sends an email confirmation instructing the affiliate to check their bank account. Declining requires an explicit reason sent to the affiliate.
                </p>
              </div>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Request ID</th>
                  <th className="p-3">Affiliate & Bank</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status & Notes</th>
                  <th className="p-3">Requested / Paid</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(analytics?.withdrawals ?? withdrawals).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      No withdrawal requests match the selected date range or payout filter.
                    </td>
                  </tr>
                ) : (
                  (analytics?.withdrawals ?? withdrawals).map((w) => {
                    const isPendingOrApproved =
                      w.status === 'Pending Review' ||
                      w.status === 'Approved' ||
                      w.status === 'Processing Payment' ||
                      w.status === 'Payment Sent';

                    return (
                      <tr key={w.id} className="hover:bg-slate-50">
                        <td className="p-3 font-mono font-bold text-slate-900">
                          <span className="block">{w.id}</span>
                          {w.transferReference && (
                            <span className="text-[10px] text-slate-500 font-normal">
                              Ref: {w.transferReference}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="font-bold text-[#061B45] block">{w.affiliateName}</span>
                          <span className="text-[10px] text-slate-500 block">
                            {w.bankName} • {w.accountNumber} ({w.accountName})
                          </span>
                        </td>
                        <td className="p-3 font-black text-[#FF7900] font-mono tabular-nums">
                          ₦{w.amount.toLocaleString('en-NG')}
                        </td>
                        <td className="p-3 space-y-1">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              w.status === 'Withdrawal Successful'
                                ? 'bg-emerald-100 text-emerald-800'
                                : w.status === 'Declined'
                                ? 'bg-red-100 text-red-700'
                                : w.status === 'Approved'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {w.status}
                          </span>
                          {w.rejectionReason && (
                            <p className="text-[10px] text-red-700 max-w-xs">
                              Reason: {w.rejectionReason}
                            </p>
                          )}
                        </td>
                        <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                          <span className="block">
                            {(w.createdAt || '').replace('T', ' ').substring(0, 16)}
                          </span>
                          {w.paymentDate && (
                            <span className="text-[10px] text-emerald-700 font-bold block">
                              Paid: {w.paymentDate.replace('T', ' ').substring(0, 16)}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setInspectingAffiliateId(w.affiliateId)}
                              className="px-2 py-1 rounded bg-[#061B45] hover:bg-[#0c2a63] text-white text-[10px] font-bold inline-flex items-center gap-1"
                              title="Open Affiliate Dashboard"
                            >
                              <Eye className="w-3 h-3 text-[#FF9200]" />
                              <span>View Dashboard</span>
                            </button>

                            {w.status === 'Pending Review' && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await handleWithdrawalStatus(w.id, 'Approved');
                                  loadAnalytics(period, customFrom, customTo, payoutFilter);
                                }}
                                className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold"
                              >
                                Approve
                              </button>
                            )}

                            {isPendingOrApproved && (
                              <button
                                type="button"
                                onClick={() =>
                                  setMarkPaidModal({
                                    withdrawal: w,
                                    transferReference: w.transferReference || '',
                                    adminNotes: w.adminNotes || '',
                                  })
                                }
                                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold"
                              >
                                Mark Paid
                              </button>
                            )}

                            {isPendingOrApproved && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeclineModal({
                                    withdrawal: w,
                                    reason: '',
                                    error: '',
                                  })
                                }
                                className="px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold"
                              >
                                Decline
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 3. Persistent Customer Referral Attribution Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-x-auto">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                  Referred Customer Relationships ({referredCustomers.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Customers bound to their original affiliate across all store products & future repeat orders.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${
                  recurringEnabled
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                Policy: {recurringEnabled ? 'Recurring ON' : 'First Purchase Only'}
              </span>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 uppercase font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">Referred Customer</th>
                  <th className="p-3">Original Affiliate</th>
                  <th className="p-3">First Qualifying Purchase</th>
                  <th className="p-3">Commissioned / Total Orders</th>
                  <th className="p-3">Last Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {referredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      No referred customer attributions recorded yet.
                    </td>
                  </tr>
                ) : (
                  referredCustomers.map((rc) => (
                    <tr key={rc.id || rc.customerEmail} className="hover:bg-slate-50">
                      <td className="p-3">
                        <span className="font-bold text-slate-900 block">
                          {rc.customerName || rc.customerEmail}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {rc.customerEmail}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-bold text-[#FF7900]">
                        {rc.referralCode}
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rc.firstPurchaseCompleted
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {rc.firstPurchaseCompleted ? 'Completed' : 'Pending First Paid Order'}
                        </span>
                      </td>
                      <td className="p-3 font-mono tabular-nums font-bold text-slate-800">
                        {rc.totalCommissionedOrdersCount} commissioned / {rc.totalOrdersCount} orders
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-500">
                        {(rc.updatedAt || '').replace('T', ' ').substring(0, 16)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mandatory Decline Reason Modal */}
      {declineModal && (
        <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-red-600 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Decline Withdrawal Request</span>
                </span>
                <h4 className="text-base font-black text-[#061B45] mt-0.5">
                  {declineModal.withdrawal.id} — ₦
                  {declineModal.withdrawal.amount.toLocaleString('en-NG')}
                </h4>
                <p className="text-xs text-slate-500">
                  Affiliate: {declineModal.withdrawal.affiliateName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeclineModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              Your reason will be emailed automatically to the affiliate, and ₦
              {declineModal.withdrawal.amount.toLocaleString('en-NG')} will be refunded to their available wallet balance.
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                Decline Reason (Required) <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                required
                value={declineModal.reason}
                onChange={(e) =>
                  setDeclineModal((prev) =>
                    prev ? { ...prev, reason: e.target.value, error: '' } : null
                  )
                }
                placeholder="Explain clearly why this withdrawal request is declined (e.g. Incorrect bank account name / suspected invalid referral)..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              {declineModal.error && (
                <p className="text-[11px] text-red-600 font-semibold mt-1">
                  {declineModal.error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeclineModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionSubmitting}
                onClick={async () => {
                  const trimmed = declineModal.reason.trim();
                  if (trimmed.length < 3) {
                    setDeclineModal((prev) =>
                      prev
                        ? { ...prev, error: 'Please enter a clear decline reason (at least 3 characters).' }
                        : null
                    );
                    return;
                  }
                  setActionSubmitting(true);
                  try {
                    await handleWithdrawalStatus(declineModal.withdrawal.id, 'Declined', {
                      rejectionReason: trimmed,
                    });
                    setDeclineModal(null);
                    await loadAnalytics(period, customFrom, customTo, payoutFilter);
                  } finally {
                    setActionSubmitting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold uppercase disabled:opacity-50"
              >
                {actionSubmitting ? 'Declining...' : 'Confirm Decline & Email Reason'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Paid / Transfer Reference Modal */}
      {markPaidModal && (
        <div className="fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Confirm Payout Sent</span>
                </span>
                <h4 className="text-base font-black text-[#061B45] mt-0.5">
                  {markPaidModal.withdrawal.id} — ₦
                  {markPaidModal.withdrawal.amount.toLocaleString('en-NG')}
                </h4>
                <p className="text-xs text-slate-500">
                  {markPaidModal.withdrawal.bankName} • {markPaidModal.withdrawal.accountNumber} (
                  {markPaidModal.withdrawal.accountName})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarkPaidModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                  Bank Transfer Reference (Optional)
                </label>
                <input
                  type="text"
                  value={markPaidModal.transferReference}
                  onChange={(e) =>
                    setMarkPaidModal((prev) =>
                      prev ? { ...prev, transferReference: e.target.value } : null
                    )
                  }
                  placeholder="e.g. NIP-20261117-99421"
                  className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-700 mb-1">
                  Internal Admin Notes (Optional)
                </label>
                <input
                  type="text"
                  value={markPaidModal.adminNotes}
                  onChange={(e) =>
                    setMarkPaidModal((prev) =>
                      prev ? { ...prev, adminNotes: e.target.value } : null
                    )
                  }
                  placeholder="e.g. Settled via GTBank Business"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMarkPaidModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionSubmitting}
                onClick={async () => {
                  setActionSubmitting(true);
                  try {
                    await handleWithdrawalStatus(
                      markPaidModal.withdrawal.id,
                      'Withdrawal Successful',
                      {
                        transferReference: markPaidModal.transferReference.trim() || undefined,
                        adminNotes: markPaidModal.adminNotes.trim() || undefined,
                      }
                    );
                    setMarkPaidModal(null);
                    await loadAnalytics(period, customFrom, customTo, payoutFilter);
                  } finally {
                    setActionSubmitting(false);
                  }
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold uppercase disabled:opacity-50"
              >
                {actionSubmitting ? 'Confirming...' : 'Confirm Paid & Notify Affiliate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Inspection Modal for Individual Affiliate Dashboard */}
      {inspectingAffiliateId && (
        <AffiliateDashboardView
          mode="admin_inspect"
          token={token}
          affiliateId={inspectingAffiliateId}
          settings={settings}
          onClose={() => setInspectingAffiliateId(null)}
        />
      )}
    </div>
  );
};
