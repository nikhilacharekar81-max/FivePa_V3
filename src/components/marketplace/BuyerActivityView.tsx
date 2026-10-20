import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Briefcase, 
  Clock, 
  DollarSign, 
  Filter, 
  Check, 
  ChevronDown, 
  ChevronRight, 
  List, 
  Star, 
  ShieldCheck, 
  Sparkles, 
  Zap, 
  PlusCircle, 
  X, 
  SlidersHorizontal,
  Building2,
  Tag,
  CheckCircle2,
  MessageSquare,
  FileText,
  AlertCircle,
  Archive,
  ArrowRight,
  TrendingUp,
  Layout,
  Users,
  Activity
} from 'lucide-react';
import { Project, UserAccount, Order, WorkstreamOffer } from '../../types';

interface BuyerActivityViewProps {
  projects: Project[];
  orders: Order[];
  offers: WorkstreamOffer[];
  currentUser: UserAccount | null;
  navigate: (path: string, e?: React.MouseEvent) => void;
}

export const BuyerActivityView: React.FC<BuyerActivityViewProps> = ({
  projects,
  orders,
  offers,
  currentUser,
  navigate
}) => {
  const [activeTab, setActiveTab] = useState<'projects' | 'offers'>('projects');
  const [projectFilter, setProjectFilter] = useState<string>('All Projects');
  const [searchQuery, setSearchQuery] = useState('');

  if (!currentUser) {
    return (
      <div className="max-w-4xl mx-auto py-20 text-center">
        <div className="bg-white p-12 rounded-3xl border border-slate-200 shadow-sm space-y-6">
          <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto text-indigo-600">
            <ShieldCheck className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-black text-slate-900">Private Dashboard</h1>
          <p className="text-slate-500 max-w-md mx-auto">Please log in to your account to view and manage your private buyer activity, project requests, and ongoing workstreams.</p>
          <button 
            onClick={() => navigate('/login')}
            className="px-8 py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-lg"
          >
            Login to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Filter projects belonging to current buyer
  const myProjects = useMemo(() => {
    return projects.filter(p => p.buyerId === currentUser.id);
  }, [projects, currentUser.id]);

  // Filter orders (workstreams) belonging to current buyer
  const myWorkstreams = useMemo(() => {
    return orders.filter(o => o.buyerId === currentUser.id);
  }, [orders, currentUser.id]);

  // Map projects to statuses for filtering
  // Statuses: Open for Proposals, Work in Progress, Completed, Pending, Declined, Archived
  const filteredProjects = useMemo(() => {
    return myProjects.filter(proj => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!proj.title.toLowerCase().includes(q) && !proj.description.toLowerCase().includes(q)) return false;
      }

      if (projectFilter === 'All Projects') return true;
      if (projectFilter === 'Open for Proposals') return proj.status === 'open' || proj.status === 'published';
      if (projectFilter === 'Work in Progress') return proj.status === 'in_progress';
      if (projectFilter === 'Completed') return proj.status === 'completed';
      if (projectFilter === 'Pending') return proj.moderationStatus === 'pending';
      if (projectFilter === 'Declined') return proj.moderationStatus === 'rejected' || proj.status === 'suspended';
      if (projectFilter === 'Archived') return proj.status === 'unpublished';
      return true;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [myProjects, projectFilter, searchQuery]);

  // Offers tab data
  const myOffers = useMemo(() => {
    // Offers where the order belongs to the buyer
    const myOrderIds = new Set(myWorkstreams.map(o => o.id));
    return offers.filter(of => myOrderIds.has(of.orderId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [offers, myWorkstreams]);

  // Activity Summary Statistics
  const summary = useMemo(() => {
    const posted = myProjects.length;
    const awarded = myWorkstreams.length; // Count workstreams started
    const inProgress = myWorkstreams.filter(o => ['funded_in_escrow', 'in_progress', 'delivered', 'revision'].includes(o.status)).length;
    const pendingProposals = myProjects.reduce((sum, p) => sum + (p.proposalsCount || 0), 0);
    const paidOut = myWorkstreams.filter(o => o.status === 'completed').reduce((sum, o) => sum + (o.amount || 0), 0);

    return { posted, awarded, inProgress, pendingProposals, paidOut };
  }, [myProjects, myWorkstreams]);

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'open':
      case 'published': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'in_progress':
      case 'funded_in_escrow': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'completed': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'suspended':
      case 'unpublished': return 'bg-slate-100 text-slate-500 border-slate-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Layout className="w-8 h-8 text-indigo-600" />
            My Buyer Activity
          </h1>
          <p className="text-slate-500 mt-1">Manage your project requests, proposals, and ongoing collaborations.</p>
        </div>

        <button 
          onClick={() => navigate('/post-project')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20"
        >
          <PlusCircle className="w-5 h-5" />
          <span>Post New Project</span>
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* MAIN ACTIVITY AREA */}
        <div className="flex-1 w-full space-y-6">
          {/* TABS */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-1 flex items-center gap-1 shadow-xs max-w-fit">
            <button 
              onClick={() => setActiveTab('projects')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'projects' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Projects
            </button>
            <button 
              onClick={() => setActiveTab('offers')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${activeTab === 'offers' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              Offers
            </button>
          </div>

          {activeTab === 'projects' ? (
            <>
              {/* FILTERS AND SEARCH */}
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                    {[
                      'All Projects', 
                      'Open for Proposals', 
                      'Work in Progress', 
                      'Completed', 
                      'Pending', 
                      'Declined', 
                      'Archived'
                    ].map(f => (
                      <button
                        key={f}
                        onClick={() => setProjectFilter(f)}
                        className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${projectFilter === f ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text" 
                    placeholder="Search your projects by title or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  />
                </div>
              </div>

              {/* PROJECT LIST */}
              <div className="space-y-4">
                {filteredProjects.length === 0 ? (
                  <div className="bg-white rounded-3xl border border-slate-200/80 p-16 text-center space-y-4">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                      <Briefcase className="w-10 h-10" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900">No projects found</h3>
                    <p className="text-slate-500 max-w-sm mx-auto">You haven't posted any projects matching the selected filter. Post your first project request to find top freelancers.</p>
                    <button 
                      onClick={() => navigate('/post-project')}
                      className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm"
                    >
                      Post Your First Project
                    </button>
                  </div>
                ) : (
                  filteredProjects.map(proj => (
                    <div key={proj.id} className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-lg transition-all p-6 group">
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div className="space-y-3 flex-1">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase border ${getStatusColor(proj.status)}`}>
                              {proj.status.replace('_', ' ')}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">Posted on {proj.createdAt}</span>
                            <span className="text-[11px] text-slate-400 font-medium">• Ref: {proj.id.split('_')[1]?.toUpperCase() || proj.id}</span>
                          </div>

                          <h3 
                            onClick={() => navigate(`/projects/${proj.id}`)}
                            className="text-lg font-bold text-slate-900 hover:text-indigo-600 transition-colors cursor-pointer"
                          >
                            {proj.title}
                          </h3>

                          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                            <div className="flex items-center gap-1.5 text-slate-600">
                              <DollarSign className="w-4 h-4 text-emerald-600" />
                              <span className="font-bold text-slate-900">${proj.budgetMin} - ${proj.budgetMax}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-600">
                              <FileText className="w-4 h-4 text-indigo-500" />
                              <span className="font-bold text-slate-900">{proj.proposalsCount} Proposals</span>
                            </div>
                            {myWorkstreams.some(o => o.projectId === proj.id) && (
                              <div className="flex items-center gap-1.5 text-slate-600">
                                <Users className="w-4 h-4 text-blue-500" />
                                <span className="font-bold text-slate-900">Hired</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 flex flex-col gap-2 min-w-[140px]">
                          <button 
                            onClick={() => navigate(`/projects/${proj.id}`)}
                            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                          >
                            MANAGE PROJECT
                          </button>
                          
                          {myWorkstreams.filter(o => o.projectId === proj.id).map(ord => (
                            <button 
                              key={ord.id}
                              onClick={() => navigate(`/messages/${ord.id}`)}
                              className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                              <MessageSquare className="w-3 h-3" />
                              <span>WORKSTREAM: {ord.sellerUsername || 'Freelancer'}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            /* OFFERS TAB CONTENT */
            <div className="space-y-4">
              {myOffers.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-16 text-center space-y-4">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                    <Tag className="w-10 h-10" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900">No offers yet</h3>
                  <p className="text-slate-500 max-w-sm mx-auto">Offers, invoices, and deposit requests from freelancers will appear here.</p>
                </div>
              ) : (
                myOffers.map(offer => {
                  const order = myWorkstreams.find(o => o.id === offer.orderId);
                  return (
                    <div key={offer.id} className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md transition-all">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              offer.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                              offer.status === 'accepted' || offer.status === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                              'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {offer.kind}: {offer.status}
                            </span>
                            <span className="text-xs text-slate-400">#{offer.number}</span>
                          </div>
                          <h4 className="font-bold text-slate-900">{offer.title}</h4>
                          <p className="text-xs text-slate-500 line-clamp-1">For Workstream: {order?.title || 'Unknown Order'}</p>
                        </div>

                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="block text-[10px] text-slate-400 font-black uppercase">Amount</span>
                            <span className="text-lg font-black text-indigo-600">${offer.amount}</span>
                          </div>
                          
                          <button 
                            onClick={() => navigate(`/messages/${offer.orderId}`)}
                            className="px-5 py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl shadow-sm hover:bg-slate-800 transition-colors flex items-center gap-2"
                          >
                            <span>VIEW IN CHAT</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* SIDEBAR SUMMARY PANEL */}
        <aside className="w-full lg:w-80 shrink-0 space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div className="pb-4 border-b border-slate-100">
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-600" />
                My Activity Summary
              </h2>
            </div>

            <div className="space-y-5">
              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-600">Projects Posted</span>
                </div>
                <span className="text-lg font-black text-slate-900">{summary.posted}</span>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-emerald-50 group-hover:text-emerald-600 transition-colors">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-600">Projects Awarded</span>
                </div>
                <span className="text-lg font-black text-slate-900">{summary.awarded}</span>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-600">Work in Progress</span>
                </div>
                <span className="text-lg font-black text-slate-900">{summary.inProgress}</span>
              </div>

              <div className="flex items-center justify-between group">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-amber-50 group-hover:text-amber-600 transition-colors">
                    <Clock className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-600">Pending Proposals</span>
                </div>
                <span className="text-lg font-black text-slate-900">{summary.pendingProposals}</span>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="block text-[10px] text-slate-400 font-black uppercase">Total Paid Out</span>
                  <span className="text-2xl font-black text-emerald-600">${summary.paidOut.toLocaleString()}</span>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <DollarSign className="w-6 h-6" />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Tips / Actions Card */}
          <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg shadow-indigo-600/20 space-y-4">
            <h3 className="font-bold flex items-center gap-2">
              <Zap className="w-5 h-5 text-indigo-200 fill-indigo-200" />
              Pro Buyer Tip
            </h3>
            <p className="text-xs text-indigo-100 leading-relaxed">
              Accepting multiple proposals for the same project allows you to hire a team of specialists. Each hire starts a dedicated secure escrow workstream.
            </p>
            <button 
              onClick={() => navigate('/support')}
              className="w-full py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold transition-colors border border-white/20"
            >
              Learn About Escrow
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
