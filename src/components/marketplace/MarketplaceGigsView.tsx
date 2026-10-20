import React from 'react';
import { 
  ShieldCheck, 
  Search, 
  ChevronRight, 
  Grid, 
  List, 
  Briefcase, 
  Star, 
  Heart,
  Clock,
  Send,
  Flame,
  Sparkles,
  DollarSign
} from 'lucide-react';
import { Gig, Project } from '../../types';

interface MarketplaceGigsViewProps {
  filteredGigs: Gig[];
  projects?: Project[];
  currentCategory: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeDropdown: string | null;
  setActiveDropdown: (d: string | null) => void;
  serviceOptionFilter: string;
  setServiceOptionFilter: (f: string) => void;
  sellerLevelFilter: string;
  setSellerLevelFilter: (f: string) => void;
  budgetFilter: string;
  setBudgetFilter: (f: string) => void;
  deliveryTimeFilter: number | null;
  setDeliveryTimeFilter: (d: number | null) => void;
  onlineNowOnly: boolean;
  setOnlineNowOnly: (b: boolean) => void;
  gigViewMode: 'grid' | 'list';
  setGigViewMode: (m: 'grid' | 'list') => void;
  likedGigIds: string[];
  handleToggleLike: (gigId: string, e: React.MouseEvent) => void;
  navigate: (path: string, e?: React.MouseEvent) => void;
  getGigUrl: (gig: Gig) => string;
  currentUser: any;
  setIsSignupModalOpen: (b: boolean) => void;
  slugify: (name: string) => string;
  CATEGORY_SLUGS: Record<string, string>;
}

export const MarketplaceGigsView: React.FC<MarketplaceGigsViewProps> = ({
  filteredGigs,
  projects = [],
  currentCategory,
  searchQuery,
  setSearchQuery,
  activeDropdown,
  setActiveDropdown,
  serviceOptionFilter,
  setServiceOptionFilter,
  sellerLevelFilter,
  setSellerLevelFilter,
  budgetFilter,
  setBudgetFilter,
  deliveryTimeFilter,
  setDeliveryTimeFilter,
  onlineNowOnly,
  setOnlineNowOnly,
  gigViewMode,
  setGigViewMode,
  likedGigIds,
  handleToggleLike,
  navigate,
  getGigUrl,
  currentUser,
  setIsSignupModalOpen,
  slugify,
  CATEGORY_SLUGS
}) => {
  return (
    <div>
      {/* Hero Banner */}
      <div className="relative rounded-3xl bg-slate-900 text-white p-8 md:p-12 mb-10 overflow-hidden shadow-xl">
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&h=800&fit=crop')` }}></div>
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold mb-4 border border-emerald-500/30">
            <ShieldCheck className="w-4 h-4" /> 100% Escrow Protection Guaranteed
          </div>
          <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4 text-white text-wrap balance">
            {currentCategory === 'All' ? 'Hire top freelance talent for fixed-price gigs' : `${currentCategory} Freelance Gigs`}
          </h1>
          <p className="text-slate-300 text-sm md:text-base leading-body mb-8">
            Connect with elite developers, designers, and AI experts. Funds are safely held in escrow until you approve the deliverables.
          </p>

          {/* Search Bar */}
          <div className="flex items-center bg-white rounded-2xl p-2 shadow-lg max-w-xl">
            <Search className="w-5 h-5 text-slate-400 ml-3" />
            <input 
              type="text" 
              placeholder="Search services (e.g. React, UI/UX, Automation)..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 text-sm text-fiverr-dark placeholder:text-slate-400 focus:outline-none"
            />
            <button className="px-6 py-3 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition-colors">
              Search
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar Bar */}
      <div className="relative flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-2xl p-4 mb-8 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Service Options Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setActiveDropdown(activeDropdown === 'service' ? null : 'service')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-fiverr-dark hover:bg-slate-100 transition-colors"
            >
              <span>Service options {serviceOptionFilter !== 'All' ? `(${serviceOptionFilter})` : ''}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'service' ? 'rotate-270' : 'rotate-90'} text-slate-400`} />
            </button>
            {activeDropdown === 'service' && (
              <div className="absolute left-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2 space-y-1">
                {['All', 'Development & IT', 'AI & Data', 'Design & Creative', 'Mobile Apps'].map(opt => (
                  <button
                    key={opt}
                    onClick={() => { setServiceOptionFilter(opt); setActiveDropdown(null); }}
                    className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium transition-colors ${serviceOptionFilter === opt ? 'bg-slate-900 text-white' : 'text-fiverr-dark hover:bg-slate-100'}`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Seller Details Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setActiveDropdown(activeDropdown === 'seller' ? null : 'seller')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-fiverr-dark hover:bg-slate-100 transition-colors"
            >
              <span>Seller details {sellerLevelFilter !== 'All' ? `(${sellerLevelFilter})` : ''}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'seller' ? 'rotate-270' : 'rotate-90'} text-slate-400`} />
            </button>
            {activeDropdown === 'seller' && (
              <div className="absolute left-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2 space-y-1">
                {['All', 'Top Rated', 'Level 2', 'Level 1'].map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => { setSellerLevelFilter(lvl); setActiveDropdown(null); }}
                    className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium transition-colors ${sellerLevelFilter === lvl ? 'bg-slate-900 text-white' : 'text-fiverr-dark hover:bg-slate-100'}`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Budget Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setActiveDropdown(activeDropdown === 'budget' ? null : 'budget')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-fiverr-dark hover:bg-slate-100 transition-colors"
            >
              <span>Budget {budgetFilter !== 'All' ? `(${budgetFilter})` : ''}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'budget' ? 'rotate-270' : 'rotate-90'} text-slate-400`} />
            </button>
            {activeDropdown === 'budget' && (
              <div className="absolute left-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2 space-y-1">
                {[
                  { label: 'Any Budget', value: 'All' },
                  { label: 'Under $500', value: 'under_500' },
                  { label: '$500 - $1,000', value: '500_1000' },
                  { label: '$1,000+', value: '1000_plus' },
                ].map(b => (
                  <button
                    key={b.value}
                    onClick={() => { setBudgetFilter(b.value); setActiveDropdown(null); }}
                    className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium transition-colors ${budgetFilter === b.value ? 'bg-slate-900 text-white' : 'text-fiverr-dark hover:bg-slate-100'}`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delivery Time Dropdown */}
          <div className="relative">
            <button 
              onClick={() => setActiveDropdown(activeDropdown === 'delivery' ? null : 'delivery')}
              className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-fiverr-dark hover:bg-slate-100 transition-colors"
            >
              <span>Delivery time {deliveryTimeFilter !== null ? `(≤ ${deliveryTimeFilter}d)` : ''}</span>
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${activeDropdown === 'delivery' ? 'rotate-270' : 'rotate-90'} text-slate-400`} />
            </button>
            {activeDropdown === 'delivery' && (
              <div className="absolute left-0 mt-2 w-48 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 p-2 space-y-1">
                {[
                  { label: 'Any Delivery Time', value: null },
                  { label: 'Up to 3 Days', value: 3 },
                  { label: 'Up to 5 Days', value: 5 },
                  { label: 'Up to 10 Days', value: 10 },
                ].map(d => (
                  <button
                    key={String(d.value)}
                    onClick={() => { setDeliveryTimeFilter(d.value); setActiveDropdown(null); }}
                    className={`w-full text-left px-3 py-2 text-xs rounded-xl font-medium transition-colors ${deliveryTimeFilter === d.value ? 'bg-slate-900 text-white' : 'text-fiverr-dark hover:bg-slate-100'}`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-semibold text-fiverr-dark">
          <label className="flex items-center gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={onlineNowOnly}
              onChange={(e) => setOnlineNowOnly(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4" 
            />
            <span>Online now</span>
          </label>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setGigViewMode('grid')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${gigViewMode === 'grid' ? 'bg-white text-fiverr-dark shadow-xs font-bold' : 'text-fiverr-muted hover:text-fiverr-dark'}`}
              title="Grid View"
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setGigViewMode('list')}
              className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer ${gigViewMode === 'list' ? 'bg-white text-fiverr-dark shadow-xs font-bold' : 'text-fiverr-muted hover:text-fiverr-dark'}`}
              title="Listicle View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Categories Filter Tabs with Search-Engine-Friendly URLs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 scrollbar-none">
        {['All', 'Development & IT', 'AI & Data', 'Design & Creative', 'Mobile Apps'].map(catName => {
          const slug = CATEGORY_SLUGS[catName];
          const catUrl = slug === 'all' ? '/' : `/categories/${slug}`;
          const isActive = currentCategory === catName;
          return (
            <a
              key={catName}
              href={catUrl}
              onClick={(e) => navigate(catUrl, e)}
              className={`px-4 py-2 text-xs font-medium rounded-xl whitespace-nowrap transition-all ${isActive ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-fiverr-dark hover:bg-slate-100 border border-slate-200'}`}
            >
              {catName}
            </a>
          );
        })}
      </div>

      {/* Gigs Grid or Listicle View */}
      {filteredGigs.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-xs space-y-4 my-8">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
            <Briefcase className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">No Services or Gigs Listed Yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            The marketplace is clean and ready. Register or post the first freelance service to get started!
          </p>
          <div className="pt-2">
            <button
              onClick={() => {
                if (!currentUser) setIsSignupModalOpen(true);
                else navigate('/create-gig');
              }}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition cursor-pointer"
            >
              Post First Service
            </button>
          </div>
        </div>
      ) : gigViewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {filteredGigs.map(gig => (
            <div 
              key={gig.id} 
              onClick={(e) => navigate(getGigUrl(gig), e)}
              className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col group cursor-pointer"
            >
              <div className="relative aspect-video overflow-hidden bg-slate-100">
                <img 
                  src={gig.image} 
                  alt={gig.title} 
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800&h=500&fit=crop';
                  }}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                />
                <button 
                  onClick={(e) => handleToggleLike(gig.id, e)}
                  className={`absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 backdrop-blur-md flex items-center justify-center transition-all shadow-sm cursor-pointer ${
                    likedGigIds.includes(gig.id) ? 'text-red-500 bg-white font-bold' : 'text-fiverr-dark hover:text-red-500 hover:bg-white'
                  }`}
                  title={likedGigIds.includes(gig.id) ? 'Remove from Wishlist' : 'Add to Wishlist'}
                >
                  <Heart className={`w-4 h-4 ${likedGigIds.includes(gig.id) ? 'fill-red-500 text-red-500' : ''}`} />
                </button>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between">
                <div>
                  {/* Seller info row */}
                  <a 
                    href={`/${slugify(gig.freelancerName)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/${slugify(gig.freelancerName)}`, e);
                    }}
                    className="flex items-center gap-2.5 mb-2.5 group/seller"
                  >
                    <img src={gig.freelancerAvatar} alt={gig.freelancerName} className="w-8 h-8 rounded-full object-cover" />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-fiverr-dark group-hover/seller:underline">{gig.freelancerName}</span>
                      </div>
                      <span className="text-xs text-fiverr-muted font-medium">{gig.freelancerLevel || 'Top Rated'}</span>
                    </div>
                  </a>

                  <h3 className="text-gig-title font-semibold text-slate-900 text-fiverr-dark line-clamp-2 group-hover:text-emerald-600 transition-colors mb-3 leading-gig">
                    <a
                      href={getGigUrl(gig)}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(getGigUrl(gig), e);
                      }}
                      className="text-slate-900 text-fiverr-dark hover:text-emerald-600 transition-colors block"
                    >
                      {gig.title}
                    </a>
                  </h3>
                </div>

                <div>
                  {/* Rating */}
                  <div className="flex items-center gap-1 text-sm font-bold text-fiverr-dark mb-3">
                    <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                    <span>{gig.rating}</span>
                    <span className="text-slate-400 font-normal">({gig.reviewsCount > 999 ? (gig.reviewsCount/1000).toFixed(1) + 'k' : gig.reviewsCount})</span>
                  </div>

                  {/* Price */}
                   <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] uppercase font-normal text-fiverr-muted">Starting at</span>
                    <span className="text-[18px] font-bold text-fiverr-dark">${gig.price}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredGigs.map(gig => (
            <div 
              key={gig.id} 
              onClick={(e) => navigate(getGigUrl(gig), e)}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-xl transition-all flex flex-col md:flex-row items-center justify-between gap-6 group cursor-pointer"
            >
              <div className="flex items-center gap-5 w-full md:w-auto">
                <div className="relative w-44 h-32 rounded-xl overflow-hidden bg-slate-100 shrink-0">
                  <img src={gig.image} alt={gig.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <button 
                    onClick={(e) => handleToggleLike(gig.id, e)}
                    className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center transition-all shadow-sm ${likedGigIds.includes(gig.id) ? 'text-red-500 bg-white' : 'text-fiverr-dark hover:text-red-500'}`}
                    title={likedGigIds.includes(gig.id) ? 'Remove from Wishlist' : 'Add to Wishlist'}
                  >
                    <Heart className={`w-3.5 h-3.5 ${likedGigIds.includes(gig.id) ? 'fill-red-500 text-red-500' : ''}`} />
                  </button>
                </div>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-fiverr-dark uppercase tracking-wider">{gig.category}</span>
                    <span className="text-xs text-fiverr-muted flex items-center gap-1 font-semibold">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {gig.rating} ({gig.reviewsCount} reviews)
                    </span>
                  </div>
                  <h3 className="text-gig-title font-semibold text-slate-900 text-fiverr-dark group-hover:text-emerald-600 transition-colors leading-gig line-clamp-2">
                    <a
                      href={getGigUrl(gig)}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(getGigUrl(gig), e);
                      }}
                      className="text-slate-900 text-fiverr-dark hover:text-emerald-600 transition-colors block"
                    >
                      {gig.title}
                    </a>
                  </h3>
                  <a 
                    href={`/${slugify(gig.freelancerName)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/${slugify(gig.freelancerName)}`, e);
                    }}
                    className="flex items-center gap-2 text-xs text-fiverr-muted hover:underline"
                  >
                    <img src={gig.freelancerAvatar} className="w-5 h-5 rounded-full object-cover" />
                    <span>by <strong className="text-fiverr-dark">{gig.freelancerName}</strong> ({gig.freelancerLevel || 'Top Rated'})</span>
                  </a>
                </div>
              </div>

              <div className="flex md:flex-col items-center md:items-end justify-between w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-slate-100 gap-3">
                <div className="text-left md:text-right">
                  <span className="text-[10px] uppercase text-fiverr-muted block font-medium">Starting at</span>
                  <span className="text-2xl font-bold text-fiverr-dark">${gig.price}</span>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(getGigUrl(gig), e);
                  }}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition"
                >
                  View Details & Escrow
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Featured Projects & Client Requests Section */}
      <div className="mt-16 pt-12 border-t border-slate-200/80">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-fiverr-dark tracking-tight">
              Active Buyer Projects & Bidding Opportunities
            </h2>
            <p className="text-xs text-fiverr-muted mt-1 max-w-2xl">
              Explore open client requests with funded escrow budgets. Submit proposals, bid on custom work, and collaborate securely.
            </p>
          </div>

          <button
            onClick={(e) => navigate('/projects', e)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all shadow-xs shrink-0 cursor-pointer"
          >
            <span>View All Projects ({projects.length})</span>
            <ChevronRight className="w-4 h-4 text-emerald-400" />
          </button>
        </div>

        {/* Listicle View of Projects */}
        <div className="space-y-4">
          {projects.slice(0, 8).map((project) => {
            const projectUrl = `/projects/${project.id}`;
            return (
              <div
                key={project.id}
                onClick={(e) => navigate(projectUrl, e)}
                className="bg-white rounded-2xl border border-slate-200 p-5 hover:border-emerald-500/50 hover:shadow-lg transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group cursor-pointer"
              >
                <div className="flex-1 min-w-0 space-y-2.5">
                  {/* Header Row: Buyer Info, Category Badge & Urgency */}
                  <div className="flex flex-wrap items-center gap-2.5 text-xs">
                    <div className="flex items-center gap-2">
                      <img 
                        src={project.buyerAvatar} 
                        alt={project.buyerName} 
                        className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-slate-200" 
                      />
                      <span className="font-bold text-fiverr-dark text-xs">{project.buyerName}</span>
                      <span className="text-[11px] text-slate-400 font-medium">
                        {project.countryFlag} {project.location || 'Client'}
                      </span>
                    </div>

                    <span className="text-slate-300">•</span>

                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-700 uppercase tracking-wider">
                      {project.category}
                    </span>

                    {project.isUrgent && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-orange-100 text-orange-800">
                        <Flame className="w-3 h-3 text-orange-500" /> Urgent
                      </span>
                    )}

                    {project.featured && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                        <Sparkles className="w-3 h-3 text-amber-500" /> Featured
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="font-bold text-base text-slate-900 text-fiverr-dark group-hover:text-emerald-600 transition-colors line-clamp-1 leading-snug">
                    <a 
                      href={projectUrl} 
                      onClick={(e) => { e.stopPropagation(); navigate(projectUrl, e); }}
                      className="text-slate-900 text-fiverr-dark hover:text-emerald-600 transition-colors block"
                    >
                      {project.title}
                    </a>
                  </h3>

                  {/* Description */}
                  <p className="text-xs text-fiverr-muted line-clamp-2 leading-relaxed">
                    {project.description}
                  </p>

                  {/* Skills Chips & Project Stats */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {project.skills && project.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {project.skills.slice(0, 4).map((skill, idx) => (
                          <span key={idx} className="text-[10px] font-medium bg-slate-50 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200/60">
                            {skill}
                          </span>
                        ))}
                        {project.skills.length > 4 && (
                          <span className="text-[10px] text-slate-400 font-medium">+{project.skills.length - 4} more</span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium ml-auto md:ml-0 pt-1 md:pt-0">
                      <span className="flex items-center gap-1">
                        <Send className="w-3 h-3 text-slate-400" />
                        <strong className="text-slate-700 font-bold">{project.proposalsCount || 0}</strong> proposals
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Est. {project.deadlineDays || 7} days
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Side: Budget & Submit Proposal Button */}
                <div className="flex md:flex-col items-center md:items-end justify-between w-full md:w-auto pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 gap-3 shrink-0">
                  <div className="text-left md:text-right">
                    <span className="text-[10px] text-fiverr-muted uppercase tracking-wider font-extrabold block">
                      {project.projectType === 'hourly' ? 'Hourly Budget' : 'Fixed Budget'}
                    </span>
                    <span className="text-lg font-black text-emerald-600 font-mono">
                      ${project.budgetMin} - ${project.budgetMax}
                      {project.projectType === 'hourly' && <span className="text-xs font-normal text-slate-500">/hr</span>}
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(projectUrl, e);
                    }}
                    className="px-4 py-2 bg-slate-900 hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition-all shadow-xs shrink-0 cursor-pointer flex items-center gap-1.5"
                  >
                    <span>Submit Proposal</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
