import React from 'react';
import { Star, Sparkles, ArrowRight, ShieldCheck } from 'lucide-react';
import { Gig } from '../../types';
import { slugify } from '../../utils/slugify';

interface RelatedGigsSectionProps {
  currentGig: Gig;
  allGigs?: Gig[];
  onSelectGig?: (gig: Gig) => void;
  onNavigate?: (path: string, e?: React.MouseEvent) => void;
  title?: string;
  maxItems?: number;
}

export const RelatedGigsSection: React.FC<RelatedGigsSectionProps> = ({
  currentGig,
  allGigs,
  onSelectGig,
  onNavigate,
  title = "Related & Similar Services",
  maxItems = 4
}) => {
  const dataset = allGigs || [];

  // Find related gigs by category or subcategory
  let related = dataset.filter(g => 
    g.id !== currentGig.id && 
    (g.category === currentGig.category || (g.subcategory && currentGig.subcategory && g.subcategory === currentGig.subcategory))
  );

  // If fewer than maxItems, backfill with other top rated gigs
  if (related.length < maxItems) {
    const remaining = dataset.filter(g => g.id !== currentGig.id && !related.some(r => r.id === g.id));
    related = [...related, ...remaining];
  }

  const itemsToDisplay = related.slice(0, maxItems);

  if (itemsToDisplay.length === 0) return null;


  const getGigUrl = (gig: Gig) => {
    const uname = (gig.freelancerUsername || slugify(gig.freelancerName || 'freelancer')).toLowerCase();
    const gslug = (gig.slug || slugify(gig.title)).toLowerCase();
    return `/${uname}/${gslug}`;
  };

  const handleGigClick = (gig: Gig, e: React.MouseEvent) => {
    if (onSelectGig) {
      onSelectGig(gig);
    } else if (onNavigate) {
      onNavigate(getGigUrl(gig), e);
    }
  };

  return (
    <div className="mt-8 pt-6 border-t border-slate-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-0.5 rounded-full mb-1">
            <Sparkles className="w-3 h-3 text-emerald-600" /> Handpicked Matches
          </div>
          <h3 className="text-lg font-bold text-slate-900 text-fiverr-dark">{title}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {itemsToDisplay.map((gig) => (
          <div
            key={gig.id}
            onClick={(e) => handleGigClick(gig, e)}
            className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:border-emerald-500/50 hover:shadow-lg transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div>
              <div className="relative aspect-video bg-slate-100 overflow-hidden">
                <img
                  src={gig.image}
                  alt={gig.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&h=500&fit=crop';
                  }}
                />
                <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md bg-white/90 text-slate-800 uppercase tracking-wider backdrop-blur-xs shadow-xs">
                  {gig.category}
                </span>
              </div>

              <div className="p-3.5 space-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={gig.freelancerAvatar} alt={gig.freelancerName} className="w-5 h-5 rounded-full object-cover shrink-0" />
                  <span className="text-xs font-semibold text-fiverr-dark truncate">{gig.freelancerName}</span>
                </div>

                <h4 className="font-semibold text-xs text-slate-900 text-fiverr-dark group-hover:text-emerald-600 transition-colors line-clamp-2 leading-snug">
                  {gig.title}
                </h4>

                <div className="flex items-center gap-1 text-[11px] text-amber-500 font-bold">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  <span>{gig.rating || 5.0}</span>
                  <span className="text-fiverr-muted font-normal">({gig.reviewsCount || 0})</span>
                </div>
              </div>
            </div>

            <div className="px-3.5 py-2.5 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 text-xs">
              <span className="text-[10px] uppercase text-fiverr-muted font-bold">Starting at</span>
              <span className="text-sm font-bold text-emerald-600 font-mono">${gig.price}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
