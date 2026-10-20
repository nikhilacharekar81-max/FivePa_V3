import React from 'react';
import { 
  ShieldCheck, Calendar, DollarSign, User, CheckCircle2, 
  Star, Briefcase, ExternalLink, Clock, Lock, ArrowUpRight
} from 'lucide-react';
import { WorkstreamItem } from './types';
import { UserAccount } from '../../types';

interface WorkstreamSummaryCardProps {
  order: WorkstreamItem;
  partner?: UserAccount;
  currentUser?: UserAccount | null;
  escrowRemaining?: number;
  totalReleased?: number;
  currencySymbol?: string;
  onViewPartnerProfile?: (user: UserAccount) => void;
}

export const WorkstreamSummaryCard: React.FC<WorkstreamSummaryCardProps> = ({
  order,
  partner,
  currentUser,
  escrowRemaining,
  totalReleased,
  currencySymbol = '$',
  onViewPartnerProfile
}) => {
  const isBuyer = currentUser?.id === order.buyerId;
  const activeEscrow = escrowRemaining !== undefined ? escrowRemaining : ((order as any).escrowRemaining ?? (order.status === 'completed' ? 0 : Number(order.amount || 0)));
  const releasedAmt = totalReleased !== undefined ? totalReleased : ((order as any).totalReleased ?? (order.status === 'completed' ? Number(order.amount || 0) : 0));

  return (
    <div className="bg-white border border-slate-200/90 rounded-3xl p-6 shadow-xs space-y-6">
      {/* FIVERR-STYLE FINANCIAL METRICS CARD (WorkPerHour Green Branded) */}
      <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white p-6 rounded-2xl relative overflow-hidden shadow-sm space-y-4">
        {/* Subtle decorative background glow */}
        <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-emerald-500/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-200 block mb-1">
              Held in Escrow
            </span>
            <div className="text-3xl font-black tracking-tight font-mono tabular-nums">
              {currencySymbol}{Number(activeEscrow || 0).toLocaleString()}
            </div>
          </div>
          <div className="w-12 h-12 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl flex items-center justify-center text-white shadow-xs">
            <ShieldCheck className="w-6 h-6 text-emerald-300" />
          </div>
        </div>

        <div className="relative z-10 pt-4 border-t border-white/15 grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-[10px] text-emerald-200/80 uppercase font-bold tracking-wider block mb-0.5">Released / Paid</span>
            <span className="font-mono font-bold text-white text-sm tabular-nums">{currencySymbol}{Number(releasedAmt || 0).toLocaleString()}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-emerald-200/80 uppercase font-bold tracking-wider block mb-0.5">Total Value</span>
            <span className="font-mono font-bold text-white text-sm tabular-nums">{currencySymbol}{Number(order.amount || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="relative z-10 pt-2 border-t border-white/10 flex items-center gap-2 text-xs text-emerald-100 font-medium">
          <Lock className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
          <span className="leading-snug">
            {activeEscrow > 0
              ? '100% Secured in Escrow Vault'
              : releasedAmt > 0
                ? 'Invoice Paid • Ready for Follow-on Proposals'
                : 'Awaiting Proposal Deposit'}
          </span>
        </div>
      </div>

      {/* COLLABORATOR / PARTNER CARD (Fiverr Profile UX) */}
      {partner && (
        <div className="space-y-3 pt-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            {isBuyer ? 'Assigned Freelancer / Seller' : 'Client / Buyer'}
          </span>
          <div className="flex items-center justify-between p-3 bg-slate-50/80 border border-slate-200/70 rounded-2xl hover:bg-slate-50 transition">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={partner.avatar}
                  alt={partner.name}
                  className="w-12 h-12 rounded-2xl object-cover border-2 border-white shadow-2xs"
                />
                {partner.kycStatus === 'verified' && (
                  <div className="absolute -bottom-1 -right-1 bg-emerald-600 text-white p-0.5 rounded-full border-2 border-white shadow-2xs" title="Verified User">
                    <CheckCircle2 className="w-3 h-3" />
                  </div>
                )}
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1">
                  <span>{partner.name}</span>
                </h4>
                <p className="text-[11px] text-slate-500 font-medium">
                  {partner.ActiveRole || (isBuyer ? 'Specialist' : 'Project Owner')}
                </p>
              </div>
            </div>
            {onViewPartnerProfile && (
              <button
                onClick={() => onViewPartnerProfile(partner)}
                className="p-2.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition cursor-pointer border border-transparent hover:border-emerald-200"
                title="View Full Profile"
              >
                <ArrowUpRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ORDER METADATA (Fiverr Specification Cards) */}
      <div className="space-y-3.5 pt-4 border-t border-slate-100 text-xs">
        <div className="flex items-center justify-between text-slate-600">
          <span className="flex items-center gap-2 font-medium">
            <Briefcase className="w-4 h-4 text-slate-400" />
            <span>Workstream Type</span>
          </span>
          <span className="font-bold text-slate-900 uppercase text-[10px] px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg">
            {order.type === 'gig' ? 'Pre-Funded Gig / Offer' : 'Custom Project'}
          </span>
        </div>

        <div className="flex items-center justify-between text-slate-600">
          <span className="flex items-center gap-2 font-medium">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span>Started Date</span>
          </span>
          <span className="font-bold text-slate-900 font-mono text-[11px]">{order.createdAt}</span>
        </div>

        <div className="flex items-center justify-between text-slate-600">
          <span className="flex items-center gap-2 font-medium">
            <Clock className="w-4 h-4 text-slate-400" />
            <span>Current Stage</span>
          </span>
          <span className={`font-bold uppercase text-[10px] px-3 py-1 rounded-full border shadow-2xs ${
            order.status === 'completed' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
            order.status === 'delivered' ? 'bg-amber-50 text-amber-800 border-amber-200' :
            order.status === 'revision' ? 'bg-purple-50 text-purple-800 border-purple-200' :
            'bg-blue-50 text-blue-800 border-blue-200'
          }`}>
            {order.status.replace('_', ' ')}
          </span>
        </div>
      </div>
    </div>
  );
};
