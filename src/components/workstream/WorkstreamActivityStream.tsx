import React, { useEffect, useRef, useState, useMemo } from 'react';
import { formatMessageTime } from '../../utils/messageTime';
import {
  FileText, Download, ShieldCheck, Activity, CheckCircle2,
  Clock, AlertTriangle, MessageSquare, Sparkles,
  FileSignature, Receipt, Lock, Loader2, RotateCcw, ExternalLink,
  Star, Briefcase, Package, Scale, CreditCard,
  Award, ShieldAlert, Video, PhoneMissed, Layers,
  DollarSign, Check
} from 'lucide-react';
import { WorkstreamMessage, WorkstreamOffer, WorkstreamItem } from './types';
import { UserAccount } from '../../types';
import {
  classifyActivityEvent,
  matchesActivityFilter,
  formatDividerDate,
  formatEventTime,
  ActivityFilter,
  ClassifiedEvent
} from './activityClassifier';

interface WorkstreamActivityStreamProps {
  messages: WorkstreamMessage[];
  currentUserId?: string;
  usersList?: UserAccount[];
  partnerUser?: UserAccount;
  onDownloadFile?: (fileInfo: { name: string; url: string }) => void;
  /** Real offer records for this workstream (the source of truth for every offer card). */
  offers?: WorkstreamOffer[];
  buyerId?: string;
  sellerId?: string;
  orderAmount?: number;
  escrowRemaining?: number;
  orderReview?: any;
  sellerReview?: any;
  onOfferAction?: (offerId: string, action: 'accept' | 'decline' | 'cancel') => Promise<{ ok: boolean; error?: string }>;
  onRequestRevisionFromInvoice?: () => void;
  onReplyReview?: (reviewId: string, replyText: string) => Promise<{ ok: boolean; error?: string }>;
  onRetryMessage?: (msg: WorkstreamMessage) => void;
  order?: WorkstreamItem;
  onOpenDeliverModal?: () => void;
  onOpenReleaseModal?: () => void;
  onOpenRevisionModal?: () => void;
  onOpenReviewModal?: () => void;
  onOpenDisputeModal?: () => void;
  onStartVideoCall?: () => void;
}

export const WorkstreamActivityStream: React.FC<WorkstreamActivityStreamProps> = ({
  messages,
  currentUserId,
  usersList = [],
  partnerUser,
  onDownloadFile,
  offers = [],
  buyerId,
  sellerId,
  orderAmount,
  escrowRemaining,
  orderReview,
  sellerReview,
  onOfferAction,
  onRequestRevisionFromInvoice,
  onReplyReview,
  onRetryMessage,
  order,
  onOpenDeliverModal,
  onOpenReleaseModal,
  onOpenRevisionModal,
  onOpenReviewModal,
  onOpenDisputeModal,
  onStartVideoCall
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>('all');
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [confirmingOffer, setConfirmingOffer] = useState<{ offer: WorkstreamOffer; action: 'accept' | 'decline' | 'cancel' } | null>(null);
  const [offerError, setOfferError] = useState<{ id: string; message: string } | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const KIND_CFG = {
    proposal: { label: 'Proposal', icon: <FileSignature className="w-4 h-4" />, accept: 'Accept & Fund Escrow' },
    invoice: { label: 'Invoice', icon: <Receipt className="w-4 h-4" />, accept: 'Pay Invoice & Release Escrow' },
    deposit: { label: 'Deposit Request', icon: <Lock className="w-4 h-4" />, accept: 'Fund Escrow Deposit' }
  } as const;

  const STATUS_CFG: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Awaiting buyer', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
    accepted: { label: 'Escrow Funded', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    paid: { label: 'Paid & Released', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-200' }
  };

  const executeOfferAction = async (offer: WorkstreamOffer, action: 'accept' | 'decline' | 'cancel') => {
    if (!onOfferAction || busyOfferId) return;
    setConfirmingOffer(null);
    setBusyOfferId(offer.id);
    setOfferError(null);
    const result = await onOfferAction(offer.id, action);
    setBusyOfferId(null);
    if (!result.ok) setOfferError({ id: offer.id, message: result.error || 'Action failed.' });
  };

  /** Filter counts */
  const counts = useMemo(() => {
    const res = {
      all: messages.length,
      deliveries: 0,
      financial: 0,
      proposals_orders: 0,
      system_audit: 0,
      chat_only: 0
    };
    for (const m of messages) {
      if (matchesActivityFilter(m, 'deliveries')) res.deliveries++;
      if (matchesActivityFilter(m, 'financial')) res.financial++;
      if (matchesActivityFilter(m, 'proposals_orders')) res.proposals_orders++;
      if (matchesActivityFilter(m, 'system_audit')) res.system_audit++;
      if (matchesActivityFilter(m, 'chat_only')) res.chat_only++;
    }
    return res;
  }, [messages]);

  const filteredMessages = useMemo(() => {
    return messages.filter(m => matchesActivityFilter(m, activeFilter));
  }, [messages, activeFilter]);

  /** Maps icon names to Lucide icons */
  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'FileSignature': return <FileSignature className="w-4 h-4" />;
      case 'Receipt': return <Receipt className="w-4 h-4" />;
      case 'Lock': return <Lock className="w-4 h-4" />;
      case 'ShieldCheck': return <ShieldCheck className="w-4 h-4" />;
      case 'CheckCircle2': return <CheckCircle2 className="w-4 h-4" />;
      case 'RotateCcw': return <RotateCcw className="w-4 h-4" />;
      case 'Package': return <Package className="w-4 h-4" />;
      case 'Briefcase': return <Briefcase className="w-4 h-4" />;
      case 'Clock': return <Clock className="w-4 h-4" />;
      case 'Award': return <Award className="w-4 h-4" />;
      case 'Sparkles': return <Sparkles className="w-4 h-4" />;
      case 'Scale': return <Scale className="w-4 h-4" />;
      case 'Star': return <Star className="w-4 h-4 fill-amber-400 text-amber-400" />;
      case 'Video': return <Video className="w-4 h-4" />;
      case 'PhoneMissed': return <PhoneMissed className="w-4 h-4" />;
      case 'FileText': return <FileText className="w-4 h-4" />;
      case 'ShieldAlert': return <ShieldAlert className="w-4 h-4" />;
      case 'CreditCard': return <CreditCard className="w-4 h-4" />;
      case 'DollarSign': return <DollarSign className="w-4 h-4" />;
      case 'Layers': return <Layers className="w-4 h-4" />;
      case 'AlertTriangle': return <AlertTriangle className="w-4 h-4" />;
      default: return <Activity className="w-4 h-4" />;
    }
  };

  /** Renders the polished Fiverr-Style Interactive Offer Card (PRP-xxxx, INV-xxxx, DEP-xxxx) */
  const renderOfferCard = (msg: WorkstreamMessage, _isMe: boolean, keyStr: string) => {
    const offer = offers.find(o => o.id === msg.metadata?.offerId);
    if (!offer) {
      return (
        <div key={keyStr} className="flex justify-center my-3">
          <div className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl p-4 text-xs text-slate-400 flex items-center justify-center gap-2 shadow-2xs">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span>Loading offer details ({msg.text})...</span>
          </div>
        </div>
      );
    }
    const cfg = KIND_CFG[offer.kind] || KIND_CFG.proposal;
    const st = STATUS_CFG[offer.status] || STATUS_CFG.pending;
    const sym = offer.currencySymbol || '$';
    const iAmBuyer = !!currentUserId && currentUserId === buyerId;
    const iAmSeller = !!currentUserId && currentUserId === sellerId;
    const busy = busyOfferId === offer.id;
    const activeEscrow = escrowRemaining !== undefined ? Number(escrowRemaining) : Number(orderAmount || 0);
    const hasAdditional = offer.kind === 'invoice' && offer.amount > activeEscrow;
    const offerFiles = Array.isArray(offer.files) && offer.files.length > 0
      ? offer.files
      : (Array.isArray(msg.metadata?.files) ? msg.metadata.files : []);
    const offerRef = offer.reference || msg.metadata?.reference;
    const isConfirmingThis = confirmingOffer?.offer.id === offer.id;

    return (
      <div key={keyStr} className="flex justify-center my-4">
        <div className="w-full max-w-xl bg-white border border-slate-200/90 rounded-2xl shadow-xs hover:shadow-sm transition-all overflow-hidden">
          {/* Top category banner */}
          <div className="px-5 py-3 bg-gradient-to-r from-emerald-50/90 to-slate-50/80 border-b border-emerald-100 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center ring-1 ring-emerald-200">
                {cfg.icon}
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-950 block leading-tight">
                  {cfg.label} {offer.number}
                </span>
                <span className="text-[10px] text-slate-500 font-medium font-mono tabular-nums">
                  {formatEventTime(msg.timestamp)}
                </span>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${st.cls}`}>
              {offer.status === 'pending' && iAmSeller ? 'Awaiting buyer payment' : st.label}
            </span>
          </div>

          <div className="p-5 space-y-4">
            {/* Title & Price */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">{offer.title}</h4>
                {offer.deliveryDays && (
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>Estimated delivery in <strong className="text-slate-800">{offer.deliveryDays}</strong> day{offer.deliveryDays === 1 ? '' : 's'}</span>
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <span className="text-2xl font-black text-slate-900 font-mono tabular-nums tracking-tight">{sym}{offer.amount.toLocaleString()}</span>
                <span className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider">Fixed Price</span>
              </div>
            </div>

            {/* Escrow breakdown badge */}
            {offer.kind === 'invoice' && offer.status === 'pending' && (
              <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 font-medium space-y-1">
                {hasAdditional ? (
                  <div className="flex items-center justify-between font-mono tabular-nums">
                    <span>Escrow available: <strong>{sym}{activeEscrow.toLocaleString()}</strong></span>
                    <span>Additional debit: <strong className="text-emerald-700">+{sym}{(offer.amount - activeEscrow).toLocaleString()}</strong></span>
                  </div>
                ) : (
                  <div className="text-emerald-800 font-semibold flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>100% covered by funded Escrow deposit ({sym}{activeEscrow.toLocaleString()} held in vault)</span>
                  </div>
                )}
              </div>
            )}

            {/* Scope & Details Note */}
            {offer.note && (
              <div className="text-xs text-slate-700 leading-relaxed bg-slate-50/80 p-3.5 rounded-xl border border-slate-200 whitespace-pre-wrap">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Scope & Deliverables</span>
                {offer.note}
              </div>
            )}

            {/* External Reference Link */}
            {offerRef && (
              <div className="flex items-center gap-2 text-xs text-emerald-900 bg-emerald-50/70 px-3.5 py-2 rounded-xl border border-emerald-100">
                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                <span className="truncate font-medium">{offerRef}</span>
              </div>
            )}

            {/* Attached Deliverable Files */}
            {offerFiles.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Attached Deliverable Files ({offerFiles.length})
                </span>
                <div className="flex flex-wrap gap-2">
                  {offerFiles.map((f: any, idx: number) => (
                    <button
                      key={`${offer.id}-f-${idx}`}
                      type="button"
                      onClick={() => onDownloadFile?.(f)}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 border border-slate-200 hover:border-emerald-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate max-w-[190px]">{f.name || 'Deliverable file'}</span>
                      {f.size && <span className="text-[10px] text-slate-500">({f.size})</span>}
                      <Download className="w-3.5 h-3.5 text-slate-400 hover:text-emerald-700 ml-0.5 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Buyer Action Buttons */}
            {offer.status === 'pending' && iAmBuyer && !isConfirmingThis && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingOffer({ offer, action: 'accept' })}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-2xs"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{cfg.accept}</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => executeOfferAction(offer, 'decline')}
                    className="px-4 py-2.5 border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Decline
                  </button>
                </div>
                {offer.kind === 'invoice' && onRequestRevisionFromInvoice && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onRequestRevisionFromInvoice}
                    className="w-full py-2 px-3 bg-purple-50 hover:bg-purple-100 text-purple-950 border border-purple-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-purple-600" />
                    <span>Request Modification / Revision</span>
                  </button>
                )}
              </div>
            )}

            {/* Buyer Confirmation Panel */}
            {isConfirmingThis && confirmingOffer?.action === 'accept' && (
              <div className="p-4 rounded-xl bg-emerald-50/90 border border-emerald-200 space-y-3 animate-in fade-in">
                <div className="flex items-center gap-2 text-emerald-950 font-bold text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>
                    {offer.kind === 'invoice'
                      ? `Confirm Payment: Invoice ${offer.number} (${sym}${offer.amount.toLocaleString()})`
                      : `Confirm ${cfg.accept} (${sym}${offer.amount.toLocaleString()})`}
                  </span>
                </div>
                <p className="text-xs text-emerald-900 leading-relaxed font-mono tabular-nums">
                  {offer.kind === 'invoice' ? (
                    hasAdditional ? (
                      <>Releases <strong>{sym}{activeEscrow.toLocaleString()}</strong> from Escrow and debits <strong>{sym}{Number(offer.clientAdditionalTotal ?? (offer.amount - activeEscrow)).toLocaleString()}</strong> (incl. processing fees) from your wallet.</>
                    ) : (
                      <>Releases <strong>{sym}{offer.amount.toLocaleString()}</strong> directly from your funded Escrow deposit to the seller's wallet. No extra wallet charge.</>
                    )
                  ) : (
                    <>Funds <strong>{sym}{offer.amount.toLocaleString()}</strong> into WorkPerHour Escrow Vault under 14-day protection (total wallet debit: <strong>{sym}{Number(offer.clientTotal ?? offer.amount).toLocaleString()}</strong> incl. fees).</>
                  )}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => executeOfferAction(offer, 'accept')}
                    className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Confirm & Proceed</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmingOffer(null)}
                    className="py-2 px-3 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Seller Cancel Button */}
            {offer.status === 'pending' && iAmSeller && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => executeOfferAction(offer, 'cancel')}
                  className="px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Cancel {cfg.label.toLowerCase()}
                </button>
              </div>
            )}

            {offerError?.id === offer.id && (
              <p className="text-xs font-semibold text-rose-600 pt-1">{offerError.message}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  /** Renders the complete, polished Fiverr-style Visual Card for system and activity events */
  const renderVisualActivityCard = (msg: WorkstreamMessage, uniqueKey: string) => {
    const meta = msg.metadata || {};
    const info: ClassifiedEvent = classifyActivityEvent(msg);
    const delivFiles = Array.isArray(meta.files) ? meta.files : [];
    const iAmSeller = !!currentUserId && currentUserId === sellerId;
    const iAmBuyer = !!currentUserId && currentUserId === buyerId;
    const orderIsCompleted = order?.status === 'completed';

    // Review response logic
    const canSellerReplyToReview =
      info.category === 'review' &&
      iAmSeller &&
      orderReview?.id &&
      !orderReview?.reply &&
      !!onReplyReview &&
      meta.reviewerRole !== 'seller';

    const existingReply = meta.reply || orderReview?.reply;

    return (
      <div key={uniqueKey} className="flex justify-start my-3">
        <div className="w-full bg-white border border-slate-200/90 rounded-2xl shadow-xs hover:shadow-sm transition-all overflow-hidden">
          {/* Top Category Strip */}
          <div className={`px-5 py-2.5 flex items-center justify-between gap-3 ${info.headerCls}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${info.iconBgCls}`}>
                {renderIcon(info.iconName)}
              </div>
              <span className="text-[11px] font-bold uppercase tracking-wider truncate">
                {info.categoryLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${info.badgeCls}`}>
                {info.badgeLabel || msg.senderName || 'WorkPerHour System'}
              </span>
              <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap font-mono tabular-nums">
                {formatEventTime(msg.timestamp)}
              </span>
            </div>
          </div>

          {/* Main Card Content */}
          <div className="p-5 space-y-3.5">
            <div>
              <h4 className="text-sm font-bold text-slate-900 leading-snug">
                {info.title}
              </h4>
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                {info.description}
              </p>
            </div>

            {/* 1. PROJECT EVENT DETAILS */}
            {info.category === 'project' && (
              <div className="p-3.5 bg-teal-50/60 rounded-xl border border-teal-100 text-xs text-teal-950 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] font-semibold">
                  <div className="flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-teal-600" />
                    <span>Project: {order?.title || meta.title || 'Marketplace Project'}</span>
                  </div>
                  {order?.amount && (
                    <span className="font-mono tabular-nums font-bold text-teal-800">
                      Budget: ${order.amount.toLocaleString()} USD
                    </span>
                  )}
                </div>
                {meta.scope && (
                  <p className="text-xs text-teal-900 leading-relaxed">{meta.scope}</p>
                )}
              </div>
            )}

            {/* 2. PROPOSAL EVENT DETAILS */}
            {info.category === 'proposal' && meta.amount && (
              <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-center justify-between text-xs text-emerald-950">
                <div className="flex items-center gap-2">
                  <FileSignature className="w-4 h-4 text-emerald-600" />
                  <span>Bid Amount: <strong className="font-mono tabular-nums">${Number(meta.amount).toLocaleString()} USD</strong></span>
                </div>
                {meta.deliveryDays && (
                  <span className="text-slate-500 text-[11px]">Delivery: {meta.deliveryDays} days</span>
                )}
              </div>
            )}

            {/* 3. ORDER / HIRING SPECIFICS */}
            {info.category === 'order' && (
              <div className="p-3.5 bg-blue-50/60 rounded-xl border border-blue-100 space-y-2 text-xs text-blue-950">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>WorkPerHour Escrow Protection Active</span>
                  </span>
                  {order?.dueDate && (
                    <span className="text-slate-500 font-mono tabular-nums">Due: {order.dueDate}</span>
                  )}
                </div>
              </div>
            )}

            {/* 4. DELIVERABLE SPECIFICS */}
            {info.category === 'delivery' && (
              <div className="space-y-3 pt-1">
                {/* Notes callout */}
                {meta.notes && (
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 leading-relaxed">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Submission Notes</span>
                    {meta.notes}
                  </div>
                )}

                {/* Reference URL */}
                {meta.reference && (
                  <div className="flex items-center gap-2 text-xs text-blue-900 bg-blue-50/70 px-3.5 py-2 rounded-xl border border-blue-100">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0 text-blue-600" />
                    <span className="font-semibold text-[11px] text-blue-950">Reference:</span>
                    <span className="truncate font-medium">{meta.reference}</span>
                  </div>
                )}

                {/* Files attached */}
                {delivFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Deliverable Files ({delivFiles.length})
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {delivFiles.map((f: any, fIdx: number) => (
                        <button
                          key={`${uniqueKey}-f-${fIdx}`}
                          type="button"
                          onClick={() => onDownloadFile?.(f)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-emerald-50 text-slate-800 hover:text-emerald-950 border border-slate-200 hover:border-emerald-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="truncate max-w-[190px]">{f.name || 'Deliverable'}</span>
                          {f.size && <span className="text-[10px] text-slate-500 font-mono tabular-nums">({f.size})</span>}
                          <Download className="w-3.5 h-3.5 text-slate-400 hover:text-emerald-700 ml-0.5 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Buyer Actions on Delivery */}
                {iAmBuyer && !orderIsCompleted && (
                  <div className="pt-2 border-t border-slate-100 flex items-center gap-2.5">
                    {onOpenReleaseModal && (
                      <button
                        type="button"
                        onClick={onOpenReleaseModal}
                        className="flex-1 py-2 px-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Accept & Release Escrow</span>
                      </button>
                    )}
                    {onOpenRevisionModal && (
                      <button
                        type="button"
                        onClick={onOpenRevisionModal}
                        className="py-2 px-3.5 bg-purple-50 hover:bg-purple-100 text-purple-950 border border-purple-200 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-purple-600" />
                        <span>Request Revision</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 5. REVISION SPECIFICS */}
            {info.category === 'revision' && (
              <div className="space-y-3 pt-1">
                {meta.reason && (
                  <div className="p-3.5 bg-purple-50/80 rounded-xl border border-purple-200 text-xs text-purple-950 leading-relaxed">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800 block mb-1">Client Feedback & Requested Changes</span>
                    &ldquo;{meta.reason}&rdquo;
                  </div>
                )}

                {/* Seller Action: Submit Revision */}
                {iAmSeller && !orderIsCompleted && onOpenDeliverModal && (
                  <div className="pt-2 border-t border-purple-100 flex justify-end">
                    <button
                      type="button"
                      onClick={onOpenDeliverModal}
                      className="py-2 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow-2xs transition"
                    >
                      <Package className="w-3.5 h-3.5" />
                      <span>Submit Revised Deliverables</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 6. REVIEW SPECIFICS */}
            {info.category === 'review' && (
              <div className="space-y-3 pt-1">
                {/* Star rating display */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 text-amber-400">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-4 h-4 ${s <= (meta.rating || 5) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-slate-800 font-mono tabular-nums">
                    {meta.rating ? `${meta.rating}.0 / 5.0` : '5.0 / 5.0'}
                  </span>
                </div>

                {/* Comment quote */}
                {meta.comment && (
                  <div className="p-3.5 bg-amber-50/60 rounded-xl border border-amber-200 text-xs text-slate-800 italic leading-relaxed">
                    &ldquo;{meta.comment}&rdquo;
                  </div>
                )}

                {/* Existing seller reply */}
                {existingReply && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3 text-emerald-600" />
                      Freelancer Response ({existingReply.sellerName || 'Seller'}):
                    </span>
                    <p className="text-xs text-slate-700">{existingReply.text}</p>
                  </div>
                )}

                {/* Seller Reply Form */}
                {canSellerReplyToReview && (
                  <div className="pt-2 border-t border-amber-200 space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-amber-900">
                      Post Public Freelancer Response
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder="Thank the client or share your perspective..."
                        className="flex-1 px-3 py-1.5 bg-white border border-amber-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                      <button
                        type="button"
                        disabled={isSubmittingReply || !replyDraft.trim()}
                        onClick={async () => {
                          if (!onReplyReview || !orderReview?.id || !replyDraft.trim()) return;
                          setIsSubmittingReply(true);
                          setReplyError(null);
                          const res = await onReplyReview(orderReview.id, replyDraft.trim());
                          setIsSubmittingReply(false);
                          if (res.ok) setReplyDraft('');
                          else setReplyError(res.error || 'Failed to post reply.');
                        }}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                      >
                        {isSubmittingReply ? 'Posting...' : 'Reply'}
                      </button>
                    </div>
                    {replyError && <p className="text-[11px] text-rose-600 font-semibold">{replyError}</p>}
                  </div>
                )}
              </div>
            )}

            {/* 7. ESCROW SPECIFICS */}
            {info.category === 'escrow' && (
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 flex items-center gap-2.5 text-xs text-emerald-950">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-medium">Protected by WorkPerHour 14-Day Escrow Guarantee. Funds remain secure until work is verified.</span>
              </div>
            )}

            {/* 8. TIP & BONUS SPECIFICS */}
            {info.category === 'tip_bonus' && (
              <div className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-200 flex items-center gap-3 text-xs text-amber-950 font-medium">
                <Award className="w-5 h-5 text-amber-600 shrink-0" />
                <div>
                  <span className="font-bold block">Appreciation Bonus Credited</span>
                  <span>Buyer awarded freelancer an additional bonus tip for high-quality delivery.</span>
                </div>
              </div>
            )}

            {/* 9. DEADLINE SPECIFICS */}
            {info.category === 'deadline' && (meta.oldDate || meta.newDueDate) && (
              <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-100 flex items-center justify-between text-xs text-amber-950 font-medium">
                <span>Previous Due: <strong className="font-mono tabular-nums">{meta.oldDate || '-'}</strong></span>
                <span className="text-amber-500">➔</span>
                <span>New Due Date: <strong className="font-mono tabular-nums text-emerald-700">{meta.newDueDate || '-'}</strong></span>
              </div>
            )}

            {/* 10. DISPUTE SPECIFICS */}
            {info.category === 'dispute' && (
              <div className="space-y-2">
                {meta.notes && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Mediation Notes</span>
                    {meta.notes}
                  </div>
                )}
                {onOpenDisputeModal && (
                  <div className="pt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={onOpenDisputeModal}
                      className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                    >
                      View Dispute Details
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 11. VIDEO CALL & MEETING SPECIFICS */}
            {info.category === 'meeting' && (
              <div className="p-3.5 bg-indigo-50/70 rounded-xl border border-indigo-100 flex items-center justify-between gap-3 text-xs text-indigo-950">
                <div className="flex items-center gap-2">
                  <Video className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Workstream Live Video Conference Channel</span>
                </div>
                {onStartVideoCall && (
                  <button
                    type="button"
                    onClick={onStartVideoCall}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Start Video Call</span>
                  </button>
                )}
              </div>
            )}

            {/* 12. ORDER COMPLETION REVIEW CALL TO ACTION */}
            {info.category === 'order' && /completed/i.test(info.title) && onOpenReviewModal && !orderReview && (
              <div className="pt-2 border-t border-slate-100 flex justify-end">
                <button
                  type="button"
                  onClick={onOpenReviewModal}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <Star className="w-3.5 h-3.5" />
                  <span>Leave Feedback & Review</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeFilter]);

  let lastRenderedDate = '';

  const filterButtons: Array<{ id: ActivityFilter; label: string; count: number }> = [
    { id: 'all', label: 'All Activity', count: counts.all },
    { id: 'deliveries', label: 'Deliverables & Revisions', count: counts.deliveries },
    { id: 'proposals_orders', label: 'Proposals & Orders', count: counts.proposals_orders },
    { id: 'financial', label: 'Invoices & Escrow', count: counts.financial },
    { id: 'system_audit', label: 'System & Audit', count: counts.system_audit },
    { id: 'chat_only', label: 'Chat Only', count: counts.chat_only }
  ];

  return (
    <div className="flex flex-col bg-slate-50/50">
      {/* FIVERR-STYLE ACTIVITY FILTER BAR */}
      <div className="px-4 py-2 bg-white border-b border-slate-200/90 flex items-center justify-between gap-2 overflow-x-auto shrink-0 scrollbar-none">
        <div className="flex items-center gap-1.5 p-1 bg-slate-100/80 rounded-xl">
          {filterButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setActiveFilter(btn.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                activeFilter === btn.id
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>{btn.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono tabular-nums ${
                activeFilter === btn.id ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-200/70 text-slate-600'
              }`}>
                {btn.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* TIMELINE MESSAGES STREAM */}
      <div className="p-4 sm:p-6 space-y-4">
        {filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400 space-y-2">
            <Activity className="w-8 h-8 text-slate-300" />
            <p className="text-xs font-medium">No activity items matching the selected filter.</p>
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className="text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
            >
              Reset to All Activity
            </button>
          </div>
        ) : (
          filteredMessages.map((msg, index) => {
            const uniqueKey = `${msg.id || 'msg'}-${index}`;
            const isMe = msg.senderId === currentUserId;

            // Date grouping divider
            const msgDate = formatDividerDate(msg.timestamp);
            const shouldShowDivider = msgDate && msgDate !== lastRenderedDate;
            if (shouldShowDivider) {
              lastRenderedDate = msgDate;
            }

            // 1. Offer creation events (PRP-xxxx, INV-xxxx, DEP-xxxx)
            if (msg.metadata?.action === 'offer_created' && msg.metadata?.offerId) {
              return (
                <React.Fragment key={`wrap-${uniqueKey}`}>
                  {shouldShowDivider && (
                    <div className="flex items-center justify-center my-4">
                      <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                      <span className="mx-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase bg-white px-2.5 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                        {msgDate}
                      </span>
                      <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                    </div>
                  )}
                  {renderOfferCard(msg, isMe, uniqueKey)}
                </React.Fragment>
              );
            }

            // 2. System and meaningful activity events -> Polished Visual Activity Card
            if (msg.type === 'system' || msg.metadata?.action) {
              return (
                <React.Fragment key={`wrap-${uniqueKey}`}>
                  {shouldShowDivider && (
                    <div className="flex items-center justify-center my-4">
                      <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                      <span className="mx-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase bg-white px-2.5 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                        {msgDate}
                      </span>
                      <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                    </div>
                  )}
                  {renderVisualActivityCard(msg, uniqueKey)}
                </React.Fragment>
              );
            }

            // 3. Conversational messages (Chat bubbles)
            const senderObj = usersList.find(u => u.id === msg.senderId) || (isMe ? undefined : partnerUser);
            const avatarUrl = msg.senderAvatar || senderObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';
            const senderName = msg.senderName || senderObj?.name || (isMe ? 'You' : 'Partner');

            const isFailed = msg.status === 'failed';
            const isSending = msg.status === 'sending';

            return (
              <React.Fragment key={`wrap-${uniqueKey}`}>
                {shouldShowDivider && (
                  <div className="flex items-center justify-center my-4">
                    <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                    <span className="mx-3 text-[10px] font-bold tracking-wider text-slate-500 uppercase bg-white px-2.5 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                      {msgDate}
                    </span>
                    <div className="h-px bg-slate-200/70 flex-1 max-w-[100px]" />
                  </div>
                )}
                <div key={uniqueKey} className={`flex gap-3 my-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <img src={avatarUrl} alt={senderName} className="w-8 h-8 rounded-full object-cover shrink-0 mt-0.5 border border-slate-200" />
                  <div className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'} max-w-[75%]`}>
                    <span className="text-[10px] font-bold text-slate-400 px-1">{senderName}</span>
                    <div className={`px-4 py-3 rounded-2xl text-xs ${
                      isFailed
                        ? 'bg-rose-50 border border-rose-300 text-rose-900 rounded-tr-none'
                        : isMe
                          ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-tr-none shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none shadow-xs'
                    }`}>
                      {msg.type === 'file' && msg.fileInfo ? (
                        <div className="flex items-center gap-3">
                          <div className={`p-2.5 rounded-xl ${isFailed ? 'bg-rose-100 text-rose-700' : isMe ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold truncate">{msg.fileInfo.name}</div>
                            <div className="text-[10px] opacity-70 font-mono tabular-nums">{msg.fileInfo.size}</div>
                          </div>
                          {!isFailed && (
                            <button
                              type="button"
                              onClick={() => onDownloadFile?.(msg.fileInfo!)}
                              className={`p-2 rounded-lg cursor-pointer transition ${isMe ? 'hover:bg-white/20 text-white' : 'hover:bg-slate-100 text-slate-500'}`}
                              title="Download shared file"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      )}
                    </div>

                    {/* Status and retry bar */}
                    <div className="flex items-center gap-1.5 px-1 text-[9px]">
                      {isFailed && (
                        <div className="flex items-center gap-1.5 text-rose-600 font-semibold">
                          <AlertTriangle className="w-3 h-3 text-rose-500" />
                          <span>Failed to send</span>
                          {isMe && onRetryMessage && (
                            <button
                              type="button"
                              onClick={() => onRetryMessage(msg)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-md font-bold transition cursor-pointer"
                              title="Retry sending this message"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      )}
                      {isSending && (
                        <div className="flex items-center gap-1 text-slate-400">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Sending...</span>
                        </div>
                      )}
                      {!isFailed && !isSending && (
                        <span className="text-slate-400 font-medium font-mono tabular-nums">{formatMessageTime(msg.timestamp)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
};
