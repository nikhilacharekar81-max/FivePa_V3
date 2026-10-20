import React from 'react';
import { CheckCircle2, Clock, AlertCircle, ShieldCheck } from 'lucide-react';

/**
 * Shared Currency Formatting Utility
 */
export function formatCurrency(amount: number | undefined | null, decimals: number = 2): string {
  const validAmount = Number.isFinite(amount as number) ? (amount as number) : 0;
  return `$${validAmount.toFixed(decimals)}`;
}


/**
 * Shared Status Badge Presentation Utility
 */
export function getStatusBadge(status: string): React.ReactNode {
  const normalized = (status || '').toLowerCase().trim();
  switch (normalized) {
    case 'completed':
    case 'paid':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          <span>{normalized === 'paid' ? 'Paid' : 'Completed'}</span>
        </span>
      );
    case 'delivered':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3 h-3" />
          <span>Delivered · In Review</span>
        </span>
      );
    case 'revision':
    case 'revision_requested':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-purple-50 text-purple-700 border border-purple-200">
          <Clock className="w-3 h-3" />
          <span>Revision Requested</span>
        </span>
      );
    case 'disputed':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="w-3 h-3" />
          <span>Disputed</span>
        </span>
      );
    case 'cancelled':
    case 'refunded':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
          <AlertCircle className="w-3 h-3" />
          <span>{normalized === 'refunded' ? 'Refunded' : 'Cancelled'}</span>
        </span>
      );
    case 'published':
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" />
          <span>Active</span>
        </span>
      );
    case 'paused':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700 border border-slate-200">
          <Clock className="w-3 h-3" />
          <span>Paused</span>
        </span>
      );
    case 'funded_in_escrow':
    case 'in_escrow':
    case 'in_progress':
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          <span>{normalized === 'in_escrow' ? 'In Escrow' : normalized === 'funded_in_escrow' ? 'Escrow Funded' : 'In Progress'}</span>
        </span>
      );
  }
}
