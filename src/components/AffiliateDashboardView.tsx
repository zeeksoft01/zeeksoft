import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  Calendar,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Copy,
  Eye,
  Filter,
  Loader2,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  AffiliateDashboardAnalytics,
  DatePeriodFilter,
  PayoutFilter,
  SiteSettings,
} from '../types';
import { api } from '../api/client';

interface AffiliateDashboardViewProps {
  mode: 'affiliate' | 'admin_inspect';
  token: string;
  affiliateId?: string;
  initialData?: AffiliateDashboardAnalytics | null;
  settings: SiteSettings;
  onOpenAffiliateGuide?: () => void;
  onClose: () => void;
}

const PERIOD_OPTIONS: Array<{ id: DatePeriodFilter; label: string }> = [
  { id: 'all', label: 'All Time' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Past (Yesterday)' },
  { id: 'weekly', label: 'This Week' },
  { id: 'monthly', label: 'This Month' },
  { id: 'custom', label: 'Custom Range' },
];

const PAYOUT_FILTER_OPTIONS: Array<{ id: PayoutFilter; label: string }> = [
  { id: 'all', label: 'All Payouts' },
  { id: 'upcoming', label: 'Upcoming / Pending' },
  { id: 'completed', label: 'Completed Payouts' },
  { id: 'previous', label: 'Previous Payouts' },
  { id: 'declined', label: 'Declined' },
];

const formatDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const AffiliateDashboardView: React.FC<AffiliateDashboardViewProps> = ({
  mode,
  token,
  affiliateId,
  initialData,
  settings,
  onOpenAffiliateGuide,
  onClose,
}) => {
  const [data, setData] = useState<AffiliateDashboardAnalytics | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [errorMsg, setErrorMsg] = useState('');
  const [noticeMsg, setNoticeMsg] = useState('');

  const [period, setPeriod] = useState<DatePeriodFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>('all');

  const [activeTab, setActiveTab] = useState<
    'overview' | 'transactions' | 'payouts' | 'activity'
  >('overview');

  const [copiedLink, setCopiedLink] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const fetchDashboard = async (
    nextPeriod: DatePeriodFilter = period,
    nextFrom: string = customFrom,
    nextTo: string = customTo,
    nextPayout: PayoutFilter = payoutFilter
  ) => {
    if (!token) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const filters = {
        period: nextPeriod,
        ...(nextPeriod === 'custom' && nextFrom ? { from: nextFrom } : {}),
        ...(nextPeriod === 'custom' && nextTo ? { to: nextTo } : {}),
        payoutFilter: nextPayout,
      };
      const res =
        mode === 'admin_inspect' && affiliateId
          ? await api.getAdminAffiliateDashboard(token, affiliateId, filters)
          : await api.getAffiliateDashboard(token, filters);
      setData(res);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load affiliate analytics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchDashboard('all', '', '', 'all');
    }
  }, [token, affiliateId, mode]);

  const handleSelectPeriod = (next: DatePeriodFilter) => {
    setPeriod(next);
    if (next !== 'custom') {
      fetchDashboard(next, customFrom, customTo, payoutFilter);
    }
  };

  const handleSelectPayoutFilter = (next: PayoutFilter) => {
    setPayoutFilter(next);
    fetchDashboard(period, customFrom, customTo, next);
  };

  const handleRequestWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode !== 'affiliate') return;
    setErrorMsg('');
    setNoticeMsg('');
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) {
      setErrorMsg('Please enter a valid withdrawal amount.');
      return;
    }
    setIsWithdrawing(true);
    try {
      await api.requestAffiliateWithdrawal(token, amt);
      setWithdrawAmount('');
      setNoticeMsg(
        `Withdrawal request for ₦${amt.toLocaleString('en-NG')} submitted and reserved for admin review.`
      );
      await fetchDashboard(period, customFrom, customTo, payoutFilter);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit withdrawal request.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const copyReferralLink = (code: string) => {
    const link = `${window.location.origin}/?ref=${code}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const aff = data?.affiliate;
  const metrics = data?.metrics;

  const getWithdrawalStatusStyle = (status: string) => {
    if (status === 'Withdrawal Successful') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'Approved' || status === 'Payment Sent' || status === 'Processing Payment')
      return 'bg-blue-100 text-blue-800 border-blue-200';
    if (status === 'Declined') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-amber-100 text-amber-800 border-amber-200';
  };

  return (
    <div className="fixed inset-0 z-[80] bg-[#F1F5F9] flex flex-col overflow-hidden">
      {/* Top Navbar */}
      <header className="bg-[#061B45] text-white px-4 sm:px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#FF7900] text-white font-black flex items-center justify-center shrink-0">
              {mode === 'admin_inspect' ? <Eye className="w-5 h-5" /> : <Coins className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight truncate">
                  {aff ? `${aff.fullName} — Affiliate Dashboard` : 'Affiliate Analytics Dashboard'}
                </h2>
                {mode === 'admin_inspect' && (
                  <span className="px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-amber-200 text-[10px] font-extrabold uppercase tracking-wider">
                    Admin Audit View
                  </span>
                )}
              </div>
              {aff && (
                <p className="text-[11px] text-slate-300 truncate">
                  {aff.email} • Code:{' '}
                  <span className="font-mono font-bold text-[#FF9200]">{aff.referralCode}</span> •{' '}
                  {aff.bankName ? `${aff.bankName} (${aff.accountNumber})` : 'No Bank Saved'}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'affiliate' && onOpenAffiliateGuide && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAffiliateGuide();
                }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center gap-1.5"
              >
                <BookOpen className="w-3.5 h-3.5 text-[#FF9200]" />
                <span className="hidden sm:inline">Affiliate Guide</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fetchDashboard(period, customFrom, customTo, payoutFilter)}
              disabled={loading}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white disabled:opacity-50"
              title="Refresh Data"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-[#FF7900] hover:bg-[#e56d00] text-white text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" />
              <span>{mode === 'admin_inspect' ? 'Close Audit' : 'Close'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-7xl mx-auto space-y-6 pb-10">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between gap-2">
              <span>{errorMsg}</span>
              <button type="button" onClick={() => setErrorMsg('')}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {noticeMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-2">
              <span>{noticeMsg}</span>
              <button type="button" onClick={() => setNoticeMsg('')}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Period & Duration Filters */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mr-2">
                <Calendar className="w-3.5 h-3.5 text-[#FF7900]" />
                <span>Period:</span>
              </span>
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectPeriod(opt.id)}
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

            {period === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                />
                <span className="text-xs text-slate-400">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
                />
                <button
                  type="button"
                  onClick={() => fetchDashboard('custom', customFrom, customTo, payoutFilter)}
                  className="px-3 py-1.5 rounded-lg bg-[#FF7900] text-white text-xs font-bold"
                >
                  Apply Range
                </button>
              </div>
            )}
          </div>

          {loading && !data ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-16 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-[#FF7900] mx-auto" />
              <p className="text-xs text-slate-500 font-medium">
                Loading real-time affiliate financials, commissions & payout history...
              </p>
            </div>
          ) : (
            data &&
            aff &&
            metrics && (
              <>
                {/* 4 KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Wallet Balance */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <span>Wallet Balance</span>
                      <Wallet className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="text-2xl font-black text-emerald-700 tabular-nums font-mono">
                      ₦{metrics.walletBalance.toLocaleString('en-NG')}
                    </div>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Reserved in pending payouts:{' '}
                      <strong className="text-slate-800">
                        ₦{metrics.reservedBalance.toLocaleString('en-NG')}
                      </strong>
                    </p>
                  </div>

                  {/* Total Commission (Period / Filtered) */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <span>
                        {period === 'all' ? 'Total Commission' : 'Commission (Selected Period)'}
                      </span>
                      <Coins className="w-4 h-4 text-[#FF7900]" />
                    </div>
                    <div className="text-2xl font-black text-[#FF7900] tabular-nums font-mono">
                      ₦{metrics.periodCommissionTotal.toLocaleString('en-NG')}
                    </div>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      {metrics.periodSalesCount} sales • {metrics.periodClicksCount} link visits •{' '}
                      {metrics.periodReferralsCount} referred
                    </p>
                  </div>

                  {/* Total Earnings */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <span>Total Earnings (All-Time)</span>
                      <TrendingUp className="w-4 h-4 text-[#061B45]" />
                    </div>
                    <div className="text-2xl font-black text-[#061B45] tabular-nums font-mono">
                      ₦{metrics.allTimeEarnings.toLocaleString('en-NG')}
                    </div>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Selected period total:{' '}
                      <strong className="text-slate-800">
                        ₦{metrics.periodEarningsTotal.toLocaleString('en-NG')}
                      </strong>
                    </p>
                  </div>

                  {/* Payout Summary */}
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                      <span>Total Paid Out</span>
                      <Banknote className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="text-2xl font-black text-blue-700 tabular-nums font-mono">
                      ₦{metrics.allTimeWithdrawn.toLocaleString('en-NG')}
                    </div>
                    <p className="text-[11px] text-slate-500 tabular-nums">
                      Pending/Upcoming:{' '}
                      <strong className="text-amber-700">
                        ₦{metrics.periodPendingPayouts.toLocaleString('en-NG')}
                      </strong>
                    </p>
                  </div>
                </div>

                {/* Navigation Sub-Tabs */}
                <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm w-fit">
                  {[
                    {
                      id: 'overview',
                      label: `Overview & Commissions (${data.commissions.length})`,
                      icon: Coins,
                    },
                    {
                      id: 'transactions',
                      label: `Transaction History (${data.ledger.length})`,
                      icon: Filter,
                    },
                    {
                      id: 'payouts',
                      label: `Withdrawals & Payouts (${data.withdrawals.length})`,
                      icon: Banknote,
                    },
                    {
                      id: 'activity',
                      label: `Activity History (${data.activityHistory.length})`,
                      icon: Activity,
                    },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
                          active
                            ? 'bg-[#061B45] text-white'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${active ? 'text-[#FF9200]' : 'text-slate-500'}`} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* TAB 1: OVERVIEW & COMMISSION BREAKDOWN */}
                {activeTab === 'overview' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Referral Link & Bank Box */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                        <div className="space-y-1">
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                            Personal Storewide Referral Link
                          </span>
                          <div className="flex items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                            <span className="text-xs font-mono font-bold text-[#061B45] truncate">
                              {window.location.origin}/?ref={aff.referralCode}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyReferralLink(aff.referralCode)}
                              className="px-3 py-1.5 rounded-lg bg-[#061B45] hover:bg-[#0c2a63] text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                            >
                              {copiedLink ? (
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
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
                          <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                            Configured Payout Bank Account
                          </span>
                          <p className="font-bold text-[#061B45]">
                            {aff.bankName || 'Not Configured'} —{' '}
                            <span className="font-mono">{aff.accountNumber || '—'}</span>
                          </p>
                          <p className="text-[11px] text-slate-600">{aff.accountName || '—'}</p>
                        </div>
                      </div>

                      {/* Request Payout Form (Affiliates only) OR Audit Summary (Admin) */}
                      {mode === 'affiliate' ? (
                        <form
                          onSubmit={handleRequestWithdrawal}
                          className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-extrabold uppercase tracking-wider text-[#061B45] flex items-center gap-1.5">
                              <Wallet className="w-4 h-4 text-[#FF7900]" />
                              <span>Request Bank Withdrawal</span>
                            </span>
                            <span className="text-[11px] font-mono font-bold text-emerald-700 tabular-nums">
                              Available: ₦{aff.availableBalance.toLocaleString('en-NG')}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Minimum payout: ₦
                            {(settings.minWithdrawalAmount || 100).toLocaleString('en-NG')}.
                            Approved withdrawals are paid directly to your bank account above and
                            confirmed via email.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              min={settings.minWithdrawalAmount || 100}
                              max={Math.max(0, aff.availableBalance)}
                              value={withdrawAmount}
                              onChange={(e) => setWithdrawAmount(e.target.value)}
                              placeholder={`Min ₦${(settings.minWithdrawalAmount || 100).toLocaleString('en-NG')}`}
                              className="flex-1 px-3 py-2.5 text-xs font-mono font-bold rounded-xl border border-slate-300 bg-white tabular-nums"
                            />
                            <button
                              type="submit"
                              disabled={isWithdrawing}
                              className="btn-zeek-orange px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider disabled:opacity-50"
                            >
                              {isWithdrawing ? 'Submitting...' : 'Withdraw'}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                          <span className="text-xs font-extrabold uppercase tracking-wider text-[#061B45] flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                            <span>Partner Account Standing</span>
                          </span>
                          <div className="grid grid-cols-3 gap-2.5 text-center">
                            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                                Status
                              </span>
                              <span className="text-xs font-black text-emerald-700 uppercase">
                                {aff.status}
                              </span>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                                All-Time Clicks
                              </span>
                              <span className="text-xs font-black text-[#061B45] tabular-nums">
                                {aff.totalClicks}
                              </span>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                                Total Sales
                              </span>
                              <span className="text-xs font-black text-[#FF7900] tabular-nums">
                                {aff.totalReferredSalesCount}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Commission Breakdown Table */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                          Commission Breakdown ({data.commissions.length})
                        </h3>
                      </div>
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-3">Order ID</th>
                            <th className="p-3">Product Purchased</th>
                            <th className="p-3">Order Amount</th>
                            <th className="p-3">Rate</th>
                            <th className="p-3">Commission Earned</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Date & Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.commissions.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="p-8 text-center text-slate-400">
                                No commissions recorded for this selected period.
                              </td>
                            </tr>
                          ) : (
                            data.commissions.map((c) => (
                              <tr key={c.id} className="hover:bg-slate-50">
                                <td className="p-3 font-mono font-bold text-[#061B45]">
                                  {c.orderId}
                                </td>
                                <td className="p-3">
                                  <span className="font-bold text-slate-900 block">
                                    {c.productName}
                                  </span>
                                  <span className="text-[10px] text-slate-500">
                                    {c.productDuration}
                                  </span>
                                </td>
                                <td className="p-3 font-mono tabular-nums text-slate-700">
                                  ₦{c.orderAmount.toLocaleString('en-NG')}
                                </td>
                                <td className="p-3 font-mono font-bold text-[#061B45] tabular-nums">
                                  {c.commissionRate}%
                                </td>
                                <td className="p-3 font-mono font-black text-emerald-700 tabular-nums">
                                  +₦{c.commissionAmount.toLocaleString('en-NG')}
                                </td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">
                                    {c.status}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                  {formatDateTime(c.createdAt)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Referred Customers */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                      <div className="p-4 border-b border-slate-200 flex items-center gap-2">
                        <Users className="w-4 h-4 text-[#FF7900]" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                          Referred Customers ({data.referredCustomers.length})
                        </h3>
                      </div>
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-3">Customer</th>
                            <th className="p-3">First Order</th>
                            <th className="p-3">Commissioned Orders</th>
                            <th className="p-3">Attributed Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.referredCustomers.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-slate-400">
                                No referred customers in this selected period.
                              </td>
                            </tr>
                          ) : (
                            data.referredCustomers.map((rc) => (
                              <tr key={rc.id} className="hover:bg-slate-50">
                                <td className="p-3">
                                  <span className="font-bold text-slate-900 block">
                                    {rc.customerName || 'Customer'}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-500">
                                    {rc.customerEmail}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-600">
                                  {rc.firstOrderId || '—'}
                                </td>
                                <td className="p-3 font-mono font-bold text-[#061B45] tabular-nums">
                                  {rc.totalCommissionedOrdersCount} / {rc.totalOrdersCount} orders
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                  {formatDateTime(rc.createdAt)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 2: TRANSACTION HISTORY (LEDGER) */}
                {activeTab === 'transactions' && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                    <div className="p-4 border-b border-slate-200">
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                        Affiliate Financial Transaction Ledger ({data.ledger.length})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Complete immutable record of earned commissions, withdrawal reserves,
                        payouts, refunds, and admin wallet adjustments.
                      </p>
                    </div>
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                        <tr>
                          <th className="p-3">Type</th>
                          <th className="p-3">Description</th>
                          <th className="p-3">Reference</th>
                          <th className="p-3">Amount</th>
                          <th className="p-3">Balance After</th>
                          <th className="p-3">Date & Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.ledger.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-slate-400">
                              No transactions recorded in this selected period.
                            </td>
                          </tr>
                        ) : (
                          data.ledger.map((entry) => {
                            const isCredit = entry.amount > 0;
                            const isDebit = entry.amount < 0;
                            return (
                              <tr key={entry.id} className="hover:bg-slate-50">
                                <td className="p-3">
                                  <span
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                      isCredit
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : isDebit
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }`}
                                  >
                                    {entry.type.replace(/_/g, ' ')}
                                  </span>
                                </td>
                                <td className="p-3 text-slate-700">{entry.description}</td>
                                <td className="p-3 font-mono text-[11px] text-slate-500">
                                  {entry.referenceId || '—'}
                                </td>
                                <td
                                  className={`p-3 font-mono font-black tabular-nums ${
                                    isCredit
                                      ? 'text-emerald-700'
                                      : isDebit
                                      ? 'text-red-600'
                                      : 'text-blue-700'
                                  }`}
                                >
                                  {isCredit
                                    ? `+₦${entry.amount.toLocaleString('en-NG')}`
                                    : isDebit
                                    ? `-₦${Math.abs(entry.amount).toLocaleString('en-NG')}`
                                    : 'Settled'}
                                </td>
                                <td className="p-3 font-mono font-bold text-[#061B45] tabular-nums">
                                  ₦{entry.balanceAfter.toLocaleString('en-NG')}
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                  {formatDateTime(entry.createdAt)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* TAB 3: WITHDRAWAL & PAYOUT HISTORY */}
                {activeTab === 'payouts' && (
                  <div className="space-y-4">
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mr-1">
                          Payout View:
                        </span>
                        {PAYOUT_FILTER_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleSelectPayoutFilter(opt.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              payoutFilter === opt.id
                                ? 'bg-[#FF7900] text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums">
                        Completed: <strong>{data.payouts.completed.length}</strong> • Upcoming:{' '}
                        <strong>{data.payouts.upcoming.length}</strong> • Declined:{' '}
                        <strong>{data.payouts.declined.length}</strong>
                      </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-600 uppercase font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-3">Request ID</th>
                            <th className="p-3">Amount</th>
                            <th className="p-3">Bank Account</th>
                            <th className="p-3">Transfer Reference</th>
                            <th className="p-3">Status</th>
                            <th className="p-3">Notes / Decline Reason</th>
                            <th className="p-3">Requested / Paid At</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.withdrawals.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="p-8 text-center text-slate-400">
                                No withdrawals match this filter & date range.
                              </td>
                            </tr>
                          ) : (
                            data.withdrawals.map((w) => (
                              <tr key={w.id} className="hover:bg-slate-50">
                                <td className="p-3 font-mono font-bold text-[#061B45]">
                                  {w.id}
                                </td>
                                <td className="p-3 font-mono font-black text-[#FF7900] tabular-nums">
                                  ₦{w.amount.toLocaleString('en-NG')}
                                </td>
                                <td className="p-3">
                                  <span className="font-bold text-slate-800 block">{w.bankName}</span>
                                  <span className="text-[11px] font-mono text-slate-500">
                                    {w.accountNumber} ({w.accountName})
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-600">
                                  {w.transferReference || '—'}
                                </td>
                                <td className="p-3">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-[10px] font-extrabold uppercase ${getWithdrawalStatusStyle(
                                      w.status
                                    )}`}
                                  >
                                    {w.status}
                                  </span>
                                </td>
                                <td className="p-3 text-[11px]">
                                  {w.rejectionReason ? (
                                    <span className="text-red-700 font-semibold">
                                      {w.rejectionReason}
                                    </span>
                                  ) : w.adminNotes ? (
                                    <span className="text-slate-600">{w.adminNotes}</span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="p-3 font-mono text-[11px] text-slate-500 tabular-nums">
                                  <span className="block">{formatDateTime(w.createdAt)}</span>
                                  {w.paymentDate && (
                                    <span className="text-[10px] text-emerald-700 font-bold block">
                                      Paid: {formatDateTime(w.paymentDate)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* TAB 4: ACTIVITY HISTORY */}
                {activeTab === 'activity' && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#061B45]">
                        Affiliate Activity Timeline ({data.activityHistory.length})
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Tracks referral visits, referred customer signups, earned commissions,
                        withdrawal updates, and account milestones.
                      </p>
                    </div>

                    {data.activityHistory.length === 0 ? (
                      <div className="p-10 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border border-slate-200">
                        No affiliate activity recorded in the selected date period.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                        {data.activityHistory.map((item) => {
                          const icon =
                            item.type === 'commission_earned' ? (
                              <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                            ) : item.type === 'withdrawal_declined' ? (
                              <XCircle className="w-4 h-4 text-red-600" />
                            ) : item.type === 'withdrawal_paid' || item.type === 'withdrawal_approved' ? (
                              <CheckCircle className="w-4 h-4 text-blue-600" />
                            ) : item.type === 'withdrawal_requested' ? (
                              <ArrowDownRight className="w-4 h-4 text-amber-600" />
                            ) : item.type === 'click' ? (
                              <MousePointerClick className="w-4 h-4 text-slate-500" />
                            ) : item.type === 'account_verified' ? (
                              <ShieldCheck className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Clock className="w-4 h-4 text-[#FF7900]" />
                            );

                          return (
                            <div
                              key={item.id}
                              className="p-3.5 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                                  {icon}
                                </div>
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-extrabold text-[#061B45]">
                                      {item.title}
                                    </span>
                                    {item.status && (
                                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                                        {item.status}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-slate-600 mt-0.5">
                                    {item.description}
                                  </p>
                                </div>
                              </div>

                              <div className="sm:text-right shrink-0 pl-11 sm:pl-0">
                                {typeof item.amount === 'number' && (
                                  <span className="text-xs font-mono font-black text-[#061B45] block tabular-nums">
                                    ₦{item.amount.toLocaleString('en-NG')}
                                  </span>
                                )}
                                <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                                  {formatDateTime(item.timestamp)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
};
