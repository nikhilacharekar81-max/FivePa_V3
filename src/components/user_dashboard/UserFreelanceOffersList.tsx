import React from 'react';
import { Gig } from '../../types';
import { ChevronDown, Trash2 } from 'lucide-react';

interface UserFreelanceOffersListProps {
  gigs: Gig[];
  freelanceSubFilter: string;
  activeFeatureDropdownGigId: string | null;
  onToggleDropdown: (gigId: string, e: React.MouseEvent) => void;
  onFeatureGig: (gigId: string) => void;
  onNavigateGig: (url: string, e: React.MouseEvent) => void;
  onPauseResumeGig: (gig: Gig) => void;
  onViewGigProgress: (gig: Gig) => void;
  onEditGig: (gig: Gig) => void;
  onDeleteGig: (gigId: string, title?: string) => void;
  getGigUrl: (gig: Gig) => string;
}

export const UserFreelanceOffersList: React.FC<UserFreelanceOffersListProps> = ({
  gigs,
  freelanceSubFilter,
  activeFeatureDropdownGigId,
  onToggleDropdown,
  onFeatureGig,
  onNavigateGig,
  onPauseResumeGig,
  onViewGigProgress,
  onEditGig,
  onDeleteGig,
  getGigUrl
}) => {
  if (gigs.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-xs space-y-2 bg-white border border-slate-200 rounded-3xl">
        <p className="font-semibold text-fiverr-dark">No services or offers found under &ldquo;{freelanceSubFilter}&rdquo;.</p>
        <p className="text-slate-400">Post new services or update statuses to view them in this list.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-3xl shadow-xs divide-y divide-slate-100 overflow-hidden">
      {gigs.map(gig => {
        const gUrl = getGigUrl(gig);
        return (
          <div key={gig.id} className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-slate-50/70 transition-colors">
            <div className="flex items-start sm:items-center gap-5">
              <div className="relative w-32 h-24 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                <img src={gig.image} alt={gig.title} className="w-full h-full object-cover" />
                <span className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                  gig.status === 'published' ? 'bg-emerald-600 text-white' : 'bg-slate-900/80 text-white'
                }`}>
                  {gig.status === 'published' ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="space-y-1">
                <a
                  href={gUrl}
                  onClick={(e) => onNavigateGig(gUrl, e)}
                  className="text-sm font-bold text-emerald-700 hover:text-emerald-800 hover:underline line-clamp-2 cursor-pointer"
                >
                  {gig.title}
                </a>
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-fiverr-muted font-medium">
                  <span>Last activity: 2 days ago</span>
                  <span>·</span>
                  <span className="text-yellow-500 font-bold">★ {gig.rating || 5.0} ({gig.reviewsCount || 0})</span>
                  <span>·</span>
                  <span>Price: ${gig.price}</span>
                  <span>·</span>
                  <span>♡ {gig.reviewsCount ? Math.floor(gig.reviewsCount / 2) : 0}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6 shrink-0 w-full sm:w-auto justify-between sm:justify-end">
              <div className="text-center sm:text-right">
                <span className="text-lg font-bold text-fiverr-dark block leading-tight">
                  {gig.featured ? '1' : '0'}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sold</span>
              </div>

              <div className="relative">
                <div className="inline-flex rounded-xl shadow-xs overflow-hidden border border-slate-300">
                  <button
                    onClick={() => onFeatureGig(gig.id)}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
                  >
                    {gig.featured ? '★ FEATURED' : 'FEATURE IT'}
                  </button>
                  <button
                    onClick={(e) => onToggleDropdown(gig.id, e)}
                    className="px-2.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer flex items-center justify-center"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {activeFeatureDropdownGigId === gig.id && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 text-xs font-sans" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onPauseResumeGig(gig)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                    >
                      {gig.status === 'published' ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => onViewGigProgress(gig)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                    >
                      View Progress
                    </button>
                    <button
                      onClick={() => onEditGig(gig)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDeleteGig(gig.id, gig.title)}
                      className="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 font-semibold border-t border-slate-100 cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
