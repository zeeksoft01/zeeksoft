import React, { useState } from 'react';
import {
  X,
  Search,
  CheckCircle,
  Clock,
  AlertCircle,
  ExternalLink,
  MessageCircle,
  Key,
  Receipt,
} from 'lucide-react';
import { Order, PaymentTransaction, SiteSettings } from '../types';
import { api } from '../api/client';

interface OrderLookupModalProps {
  onClose: () => void;
  settings: SiteSettings;
  onOpenOrderDelivery?: (orderId: string, customerEmail: string) => void;
}

const formatDateTime = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace('T', ' ').slice(0, 19);
  return d.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export const OrderLookupModal: React.FC<OrderLookupModalProps> = ({
  onClose,
  settings,
  onOpenOrderDelivery,
}) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [searched, setSearched] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setErrorMsg('');
    setIsLoading(true);
    setSearched(true);

    try {
      const results = await api.lookupOrdersAndPayments(query.trim());
      setOrders(results.orders || []);
      setTransactions(results.transactions || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setOrders([]);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusBadge = (order: Order) => {
    if (order.paymentStatus === 'paid') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full border border-emerald-300">
          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
          Paid & Verified
        </span>
      );
    }
    if (order.paymentStatus === 'awaiting_verification') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-300">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          Awaiting Verification
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold bg-slate-100 text-slate-800 px-2.5 py-1 rounded-full border border-slate-300">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        Awaiting Payment
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 pb-24 sm:pb-6 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl relative overflow-hidden border border-slate-200 my-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#061B45] text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-300 hover:text-white rounded-lg hover:bg-[#0c2a63]"
          >
            <X className="w-5 h-5" />
          </button>

          <span className="text-xs font-bold text-[#FF7900] tracking-widest uppercase block mb-1">
            Order & Payment History Tracking
          </span>
          <h3 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Track Your Order & Payment Receipt
          </h3>
          <p className="text-xs text-slate-300 mt-1">
            Enter your Order ID, Paystack Reference, or the email address used during checkout.
          </p>
        </div>

        {/* Body */}
        <div className="p-6 sm:p-8 space-y-6 max-h-[75vh] overflow-y-auto">
          <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                name="email"
                autoComplete="email"
                required
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Order ID, Paystack Reference, or Email *"
                className="w-full pl-10 pr-3.5 py-2.5 text-xs sm:text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#FF7900]"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="btn-zeek-orange px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider disabled:opacity-50 shrink-0"
            >
              {isLoading ? 'Checking...' : 'Track'}
            </button>
          </form>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Results List */}
          {searched && orders && (
            <div className="space-y-4">
              {orders.length === 0 && transactions.length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center text-slate-500 text-xs sm:text-sm space-y-2">
                  <p>No orders or payment transactions found matching "{query}".</p>
                  <p className="text-[11px] text-slate-400">
                    Please verify your Order ID / Paystack Reference or contact customer support on WhatsApp.
                  </p>
                </div>
              ) : (
                <>
                  {orders.map((order) => {
                    const matchedTx = transactions.find(
                      (t) =>
                        t.orderId === order.id ||
                        (order.paymentReference && t.reference === order.paymentReference)
                    );
                    const paidTime =
                      matchedTx?.paidAt || matchedTx?.createdAt || order.verifiedAt;
                    const txRef =
                      matchedTx?.reference || order.paymentReference || order.id;
                    const txStatus =
                      matchedTx?.status || order.paymentStatus;
                    const cleanWhatsApp = settings.internationalWhatsApp.replace(/\D/g, '');
                    const supportMsg = `Hello Zeek Softwares, I need assistance regarding my order ${order.id} for ${order.items[0]?.productName}. Current status is ${order.fulfillmentStatus}.`;

                    return (
                      <div
                        key={order.id}
                        className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold block uppercase">
                              Order ID
                            </span>
                            <span className="font-mono text-sm font-extrabold text-[#061B45]">
                              {order.id}
                            </span>
                          </div>
                          <div>{getStatusBadge(order)}</div>
                        </div>

                        {/* Items */}
                        <div className="space-y-1.5 text-xs">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="flex justify-between">
                              <span className="text-slate-800 font-medium">
                                {item.productName} ({item.duration}) × {item.quantity}
                              </span>
                              <span className="font-bold text-slate-900 tabular-nums">
                                ₦{(item.price * item.quantity).toLocaleString('en-NG')}
                              </span>
                            </div>
                          ))}
                        </div>

                        {/* Verified Payment & Transaction Details */}
                        <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-xs space-y-1.5">
                          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100">
                            <Receipt className="w-3.5 h-3.5 text-[#FF7900]" />
                            <span>Payment & Transaction Details</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Amount Paid:</span>
                            <strong className="text-[#FF7900] tabular-nums font-mono">
                              ₦{(matchedTx?.amount ?? order.totalAmount).toLocaleString('en-NG')}
                            </strong>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Payment Date & Time:</span>
                            <span className="font-mono text-slate-700 tabular-nums">
                              {formatDateTime(paidTime || order.createdAt)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Transaction Status:</span>
                            <strong className="text-[#061B45] uppercase">{txStatus}</strong>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span className="text-slate-500 shrink-0">Transaction Reference:</span>
                            <span className="font-mono font-bold text-[#061B45] truncate">
                              {txRef}
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px] pt-1 border-t border-slate-100">
                            <span className="text-slate-400">Fulfillment Stage:</span>
                            <strong className="text-[#061B45]">{order.fulfillmentStatus}</strong>
                          </div>
                        </div>

                        {/* Activation credentials / delivery instructions */}
                        {order.activationCredentials && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-1.5 text-xs text-emerald-950">
                            <div className="flex items-center gap-2 font-bold text-emerald-800">
                              <Key className="w-4 h-4 text-emerald-600" />
                              <span>Your Access / Activation Details:</span>
                            </div>
                            <p className="whitespace-pre-wrap font-mono text-[11px] bg-white p-2.5 rounded border border-emerald-200">
                              {order.activationCredentials}
                            </p>
                          </div>
                        )}

                        {/* Verified Delivery Portal Button for Paid Orders */}
                        {order.paymentStatus === 'paid' && onOpenOrderDelivery && (
                          <button
                            type="button"
                            onClick={() => onOpenOrderDelivery(order.id, order.customerEmail)}
                            className="btn-zeek-orange w-full py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm"
                          >
                            <ExternalLink className="w-4 h-4" />
                            <span>Access Downloads / Product Delivery</span>
                          </button>
                        )}

                        {/* WhatsApp Support Button */}
                        <a
                          href={`https://wa.me/${cleanWhatsApp}?text=${encodeURIComponent(supportMsg)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2.5 rounded-xl text-xs font-bold bg-[#16A34A] hover:bg-[#15803d] text-white flex items-center justify-center gap-2 transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>Contact Support About This Order</span>
                        </a>
                      </div>
                    );
                  })}

                  {transactions.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#061B45] block">
                        Payment History ({transactions.length})
                      </span>
                      <div className="space-y-2">
                        {transactions.map((tx) => (
                          <div
                            key={tx.reference}
                            className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2"
                          >
                            <div className="space-y-0.5 min-w-0">
                              <span className="font-mono font-bold text-[#061B45] block truncate">
                                Ref: {tx.reference}
                              </span>
                              <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
                                {formatDateTime(tx.paidAt || tx.createdAt)} • {tx.gateway.toUpperCase()}
                                {tx.channel ? ` (${tx.channel})` : ''}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-black text-emerald-700 tabular-nums block">
                                ₦{tx.amount.toLocaleString('en-NG')}
                              </span>
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase">
                                {tx.status}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
