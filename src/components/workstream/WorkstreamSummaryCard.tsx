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
      {/* FIVERR-STYLE FINANCIAL METRICS CARD */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 leading-tight">Escrow Vault</h4>
              <p className="text-xs text-gray-400 font-normal mt-0.5">WorkPerHour Protection</p>
            </div>
          </div>
          <span className="px-2.5 py-0.5 rounded-full border text-[10px] font-bold bg-emerald-50 text-emerald-800 border-emerald-200">
            {activeEscrow > 0 ? 'Protected' : (releasedAmt > 0 ? 'Released' : 'Deposit Ready')}
          </span>
        </div>

        {/* Light grey rounded inset box */}
        <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100/90 space-y-3">
          <div>
            <div className="text-xs font-normal text-gray-500">Held in Escrow</div>
            <div className="text-2xl font-bold text-gray-900 mt-1 font-mono tabular-nums tracking-tight">
              {currencySymbol}{Number(activeEscrow || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div className="pt-3 border-t border-slate-200/60 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider block mb-0.5">Released / Paid</span>
              <span className="font-mono font-bold text-gray-900 text-sm tabular-nums">{currencySymbol}{Number(releasedAmt || 0).toLocaleString()}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider block mb-0.5">Total Value</span>
              <span className="font-mono font-bold text-gray-900 text-sm tabular-nums">{currencySymbol}{Number(order.amount || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
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
