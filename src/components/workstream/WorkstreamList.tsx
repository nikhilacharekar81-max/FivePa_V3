import React, { useState } from 'react';
import { Search, Star, ShieldCheck, Clock, CheckCircle2, AlertCircle, ArrowUpRight, MessageSquare, PlusCircle } from 'lucide-react';
import { WorkstreamItem } from './types';
import { getStatusBadge } from '../../utils/formatters';

interface WorkstreamListProps {
  workstreams: WorkstreamItem[];
  selectedOrderId?: string;
  onSelectOrder: (orderId: string) => void;
  starredIds: string[];
  onToggleStar: (orderId: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onStartNewWorkstream: () => void;
  activeTab?: string;
  selectedPersonName?: string | null;
  selectedProjectTitle?: string | null;
  onClearTab?: () => void;
  onClearPersonFilter?: () => void;
  onClearProjectFilter?: () => void;
  onClearAllFilters?: () => void;
}

export const WorkstreamList: React.FC<WorkstreamListProps> = ({
  workstreams,
  selectedOrderId,
  onSelectOrder,
  starredIds,
  onToggleStar,
  searchQuery,
  onSearchChange,
  onStartNewWorkstream,
  activeTab,
  selectedPersonName,
  selectedProjectTitle,
  onClearTab,
  onClearPersonFilter,
  onClearProjectFilter,
  onClearAllFilters
}) => {
  const [selectedCheckboxes, setSelectedCheckboxes] = useState<string[]>([]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedCheckboxes(workstreams.map(w => w.id));
    } else {
      setSelectedCheckboxes([]);
    }
  };

  const handleCheckboxToggle = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCheckboxes(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const hasActiveFilters = Boolean(
    (activeTab && activeTab !== 'all') || 
    Boolean(searchQuery) || 
    Boolean(selectedPersonName) || 
    Boolean(selectedProjectTitle)
  );

  return (
    <div className="space-y-4">
      {/* SEARCH BAR & ACTIVE FILTER CHIPS */}
      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-xs space-y-3">
        <div className="flex items-center gap-3">
          <Search className="w-4 h-4 text-slate-400 ml-2 shrink-0" />
          <input
            type="text"
            placeholder="Search workstreams by title, client, or order ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-transparent text-xs text-fiverr-dark placeholder-slate-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="text-xs text-slate-400 hover:text-fiverr-dark px-2 font-medium cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Filtered by:</span>
            {activeTab && activeTab !== 'all' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[11px] font-medium">
                Tab: {activeTab.replace('_', ' ')}
                {onClearTab && (
                  <button onClick={onClearTab} className="hover:text-slate-300 cursor-pointer ml-0.5">×</button>
                )}
              </span>
            )}
            {selectedPersonName && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-medium">
                Contact: {selectedPersonName}
                {onClearPersonFilter && (
                  <button onClick={onClearPersonFilter} className="hover:text-emerald-950 cursor-pointer ml-0.5">×</button>
                )}
              </span>
            )}
            {selectedProjectTitle && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 text-[11px] font-medium max-w-xs truncate">
                Project: {selectedProjectTitle}
                {onClearProjectFilter && (
                  <button onClick={onClearProjectFilter} className="hover:text-blue-950 cursor-pointer ml-0.5">×</button>
                )}
              </span>
            )}
            {searchQuery && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800 text-[11px] font-medium">
                Query: &quot;{searchQuery}&quot;
                <button onClick={() => onSearchChange('')} className="hover:text-amber-950 cursor-pointer ml-0.5">×</button>
              </span>
            )}
            {onClearAllFilters && (
              <button
                onClick={onClearAllFilters}
                className="text-[11px] text-rose-600 hover:text-rose-700 font-bold ml-auto cursor-pointer"
              >
                Clear All
              </button>
            )}
          </div>
        )}
      </div>

      {/* TABLE */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-fiverr-muted">
                <th className="py-3.5 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={workstreams.length > 0 && selectedCheckboxes.length === workstreams.length}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </th>
                <th className="py-3.5 px-2 w-10 text-center">★</th>
                <th className="py-3.5 px-4">Contact / Partner</th>
                <th className="py-3.5 px-4">Workstream Scope & Preview</th>
                <th className="py-3.5 px-4">Status & Escrow</th>
                <th className="py-3.5 px-4 text-right">Escrow Amount</th>
                <th className="py-3.5 px-4 text-right">Delivery Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-fiverr-dark">
              {workstreams.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-3 max-w-sm mx-auto">
                      <div className="p-4 bg-slate-100 rounded-full text-slate-400">
                        <MessageSquare className="w-8 h-8 opacity-40" />
                      </div>
                      <p className="font-medium text-xs text-slate-500">
                        {hasActiveFilters 
                          ? 'No workstreams matching the active filters.' 
                          : 'You have no active workstreams right now.'}
                      </p>
                      {hasActiveFilters && onClearAllFilters ? (
                        <button
                          onClick={onClearAllFilters}
                          className="mt-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                        >
                          Clear All Filters
                        </button>
                      ) : (
                        <button
                          onClick={onStartNewWorkstream}
                          className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                        >
                          <PlusCircle className="w-4 h-4" />
                          <span>Start New Workstream</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                workstreams.map((w) => {
                  const isStarred = starredIds.includes(w.id);
                  const isChecked = selectedCheckboxes.includes(w.id);
                  const isCurrent = selectedOrderId === w.id;

                  return (
                    <tr
                      key={w.id}
                      onClick={() => onSelectOrder(w.id)}
                      className={`hover:bg-slate-50/80 cursor-pointer transition-colors group ${
                        isCurrent ? 'bg-emerald-50/60 font-medium' : ''
                      }`}
                    >
                      <td className="py-4 px-4" onClick={(e) => handleCheckboxToggle(w.id, e)}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-4 px-2 text-center" onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(w.id);
                      }}>
                        <button className="focus:outline-none transition-transform hover:scale-110">
                          <Star className={`w-4 h-4 ${
                            isStarred 
                              ? 'text-yellow-400 fill-yellow-400' 
                              : 'text-slate-300 hover:text-yellow-300'
                          }`} />
                        </button>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={w.seller?.avatar || 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&h=100&fit=crop'}
                            className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 shrink-0"
                            alt={w.seller?.name || 'Partner'}
                          />
                          <div className="min-w-0">
                            <span className="font-bold text-fiverr-dark truncate block">
                              {w.seller?.name || 'Collaborator'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Order #{w.id}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 max-w-xs">
                        <div className="truncate">
                          <span className="font-bold text-fiverr-dark hover:text-emerald-600 transition-colors block truncate">
                            {w.title}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate block mt-0.5">
                            {w.lastMessage || w.gig?.title || w.requirements || 'Initial workstream collaboration established.'}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {getStatusBadge(w.status)}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="font-bold text-sm text-fiverr-dark font-mono">
                          ${w.amount.toLocaleString()}
                        </span>
                        <span className={`text-[10px] block font-medium ${
                          w.status === 'completed' ? 'text-slate-500' : w.status === 'cancelled' ? 'text-rose-500' : 'text-emerald-600'
                        }`}>
                          {w.status === 'completed' ? 'Escrow Released ($0 Held)' : w.status === 'cancelled' ? 'Refunded ($0 Held)' : w.amount > 0 ? '100% in Escrow' : 'Unfunded'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className={`font-mono text-slate-500 whitespace-nowrap block ${w.dueDate === '2026-03-30' ? 'text-[14px]' : 'text-[11px]'}`}>
                          {w.dueDate || '-'}
                        </span>
                        <span className={`text-slate-400 block font-sans ${w.createdAt === '2026-03-26' ? 'text-[13px]' : 'text-[10px]'}`}>
                          {w.createdAt || ''}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
