import React from 'react';
import { Order } from '../../types';

interface UserFreelanceProjectsListProps {
  orders: Order[];
  freelanceSubFilter: string;
  onOpenWorkstream: (orderId: string) => void;
}

export const UserFreelanceProjectsList: React.FC<UserFreelanceProjectsListProps> = ({
  orders,
  freelanceSubFilter,
  onOpenWorkstream
}) => {
  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-xs space-y-2 bg-white border border-slate-200 rounded-3xl">
        <p className="font-semibold text-fiverr-dark">No projects found under &ldquo;{freelanceSubFilter}&rdquo;.</p>
        <p className="text-slate-400">All ongoing client milestones and workstreams will appear here.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-xs divide-y divide-slate-100 overflow-hidden">
      {orders.map(ord => {
        const isExpired = (new Date(ord.dueDate) < new Date() && ord.status !== 'completed') || ord.status === 'cancelled';
        return (
          <div key={ord.id} className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-slate-50/70 transition-colors">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  isExpired ? 'bg-red-50 text-red-700 border border-red-200' :
                  ord.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                }`}>
                  {isExpired ? 'Expired / Overdue' : ord.status.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">Order #{ord.id}</span>
              </div>
              <h4 className="text-sm font-bold text-slate-900 text-fiverr-dark">{ord.title}</h4>
              <p className="text-xs text-fiverr-muted">Due Date: {ord.dueDate === '2026-03-30' ? <span className="text-[15px]">{ord.dueDate}</span> : ord.dueDate} · Escrow Amount: <span className="font-bold text-fiverr-dark">${ord.amount}</span></p>
            </div>

            <button
              onClick={() => onOpenWorkstream(ord.id)}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors whitespace-nowrap cursor-pointer"
            >
              Open Workstream
            </button>
          </div>
        );
      })}
    </div>
  );
};
