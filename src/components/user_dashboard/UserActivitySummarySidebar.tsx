import React from 'react';

interface UserActivitySummarySidebarProps {
  totalOffers: number;
  activeOffersCount: number;
  completedOrdersCount: number;
  totalEarnings: number;
}

export const UserActivitySummarySidebar: React.FC<UserActivitySummarySidebarProps> = ({
  totalOffers,
  activeOffersCount,
  completedOrdersCount,
  totalEarnings
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-3 border-b border-slate-100">
        My Activity Summary
      </h3>
      <div className="space-y-3 text-xs">
        <div className="flex items-center justify-between text-fiverr-dark font-medium">
          <span>Offers I posted</span>
          <span className="font-bold text-fiverr-dark font-mono">{totalOffers}</span>
        </div>
        <div className="flex items-center justify-between text-fiverr-dark font-medium">
          <span>Active Offers</span>
          <span className="font-bold text-emerald-600 font-mono">{activeOffersCount}</span>
        </div>
        <div className="flex items-center justify-between text-fiverr-dark font-medium">
          <span>Completed Orders</span>
          <span className="font-bold text-fiverr-dark font-mono">{completedOrdersCount}</span>
        </div>
        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <span className="font-bold text-fiverr-dark">Total Earnings</span>
          <span className="font-bold text-emerald-600 text-sm font-mono">${totalEarnings}</span>
        </div>
      </div>
    </div>
  );
};
