import React, { useState, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import {
  Activity, AlertCircle, Bell, Briefcase, CheckCircle2, ChevronDown, ChevronRight, Clock,
  Filter, Flame, Grid, Heart, HelpCircle, List, Mail, MessageSquare,
  PlusCircle, RefreshCw, Search, Send, Shield, ShieldCheck, Sparkles, Star,
  Trash2, User, Users, Wallet
} from 'lucide-react';
import { FreelancerProfileView } from './components/FreelancerProfileView';
import { EditUserProfileModal } from './components/profile/EditUserProfileModal';
import { HeaderCategoriesNav, PPH_CATEGORIES } from './components/HeaderCategoriesNav';
import { ViewingGigModal, EditGigModal, DeleteGigModal, CreateGigView, RelatedGigsSection, GigDetailView } from './components/gigs';
import { FreelancerSearchView, ProjectSearchView, ProjectDetailView, BuyerActivityView } from './components/marketplace';
import { Reviews } from './components/gig_reviews';
import { useAppData } from './hooks/useAppData';
import { Header, Footer, ImpersonationBanner } from './layout';
import { slugify } from './utils/slugify';
import { getDeviceId } from './utils/deviceId';
import { RESERVED_ROUTES } from './shared/routes';
import type {
  WorkstreamItem,
  WorkstreamFilter,
  SharedFileItem
} from './components/workstream';
import { useWorkstream } from './hooks/workstream/useWorkstream';
import { calculateOrderFees } from './shared/fees';

const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const PaymentsModule = lazy(() => import('./components/PaymentsModule').then(m => ({ default: m.PaymentsModule })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then(m => ({ default: m.SettingsPage })));
const EditProfilePage = lazy(() => import('./components/profile/EditProfilePage').then(m => ({ default: m.EditProfilePage })));
const WorkstreamSidebar = lazy(() => import('./components/workstream/WorkstreamSidebar').then(m => ({ default: m.WorkstreamSidebar })));
const WorkstreamList = lazy(() => import('./components/workstream/WorkstreamList').then(m => ({ default: m.WorkstreamList })));
const WorkstreamWorkspace = lazy(() => import('./components/workstream/WorkstreamWorkspace').then(m => ({ default: m.WorkstreamWorkspace })));
const StartWorkstreamModal = lazy(() => import('./components/workstream/StartWorkstreamModal').then(m => ({ default: m.StartWorkstreamModal })));

const financeLedger = {
  quoteOrder: (amount: number) => calculateOrderFees(amount)
};
import { 
  WishlistModal, 
  EmailNotificationsModal, 
  SupportModal, 
  LoginModal,
  SignupModal,
  VerifyModal,
  ForgotPasswordModal,
  UserSwitchModal
} from './components/modals';

import { 
  GigExtra, 
  Gig, 
  Project, 
  Proposal, 
  Order, 
  UserAccount, 
  Dispute, 
  Refund, 
  Payout, 
  Category, 
  Review, 
  SupportTicket, 
  AuditLog, 
  Message, 
  UserEmail 
} from './types';
import { getAuthToken, setAuthToken, clearAuthToken, requestDemoSession } from './utils/authToken';
import { fetchWithRetry } from './utils/fetchRetry';

const CATEGORY_SLUGS: Record<string, string> = {
  'All': 'all',
  'Development & IT': 'technology-programming',
  'AI & Data': 'ai-services',
  'Design & Creative': 'design',
  'Mobile Apps': 'technology-programming'
};

const SLUG_TO_CATEGORY: Record<string, string> = {
  'all': 'All',
  'development-it': 'Technology & Programming',
  'ai-data': 'AI Services',
  'design-creative': 'Design',
  'mobile-apps': 'Technology & Programming'
};

// Populate map with all 10 PeoplePerHour main categories and ~70 subcategories
PPH_CATEGORIES.forEach(cat => {
  CATEGORY_SLUGS[cat.name] = cat.slug;
  SLUG_TO_CATEGORY[cat.slug] = cat.name;
  cat.subcategories.forEach(sub => {
    CATEGORY_SLUGS[sub.name] = sub.slug;
    SLUG_TO_CATEGORY[sub.slug] = sub.name;
  });
});

export default function App({ initialPath, initialData }: { initialPath?: string; initialData?: any } = {}) {
  // Routing
  const [path, setPath] = useState<string>(initialPath || (typeof window !== 'undefined' ? window.location.pathname : '/') || '/');
  
  // Impersonation State
  const [impersonatedUser, setImpersonatedUser] = useState<UserAccount | null>(null);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const updateCurrentUser = (u: UserAccount | null | ((prev: UserAccount | null) => UserAccount | null)) => {
    setCurrentUser(prev => {
      const next = typeof u === 'function' ? u(prev) : u;
      try {
        if (next) {
          if (typeof window !== 'undefined') localStorage.setItem('current_user', JSON.stringify(next));
        } else {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('current_user');
            localStorage.removeItem('user');
          }
        }
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('current_user') || localStorage.getItem('user');
        const token = getAuthToken();
        if (cached && token) {
          setCurrentUser(JSON.parse(cached));
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    const handleAppNotify = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setErrorToast(detail);
      }
    };
    window.addEventListener('app:notify', handleAppNotify as EventListener);
    return () => {
      window.removeEventListener('app:notify', handleAppNotify as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!errorToast) return;
    const timer = setTimeout(() => {
      setErrorToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [errorToast]);

  // Custom Data Hook
  const {
    users: usersList, setUsers: setUsersList,
    gigs, setGigs,
    projects, setProjects,
    proposals, setProposals,
    offers, setOffers,
    orders, setOrders,
    reviews: appReviews, setReviews: setAppReviews,
    messages, setMessages,
    disputes, setDisputes,
    refunds, setRefunds,
    payouts, setPayouts,
    categories, setCategories,
    supportTickets, setSupportTickets,
    auditLogs, setAuditLogs,
    platformFee, setPlatformFee,
    clientServiceFee, setClientServiceFee,
    smallOrderFeeThreshold, setSmallOrderFeeThreshold,
    smallOrderFeeAmount, setSmallOrderFeeAmount,
    escrowProtectionDays, setEscrowProtectionDays,
    refresh, userEmails, setUserEmails, fetchUserEmails
  } = useAppData(initialData);

  useEffect(() => {
    refresh();
  }, [currentUser, refresh]);


  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [serviceOptionFilter, setServiceOptionFilter] = useState<string>('All');
  const [sellerLevelFilter, setSellerLevelFilter] = useState<string>('All');
  const [budgetFilter, setBudgetFilter] = useState<string>('All');
  const [deliveryTimeFilter, setDeliveryTimeFilter] = useState<number | null>(null);
  const [proServicesOnly, setProServicesOnly] = useState<boolean>(false);
  const [onlineNowOnly, setOnlineNowOnly] = useState<boolean>(false);

  // Proposal & Creation states
  const [proposalBid, setProposalBid] = useState('');
  const [proposalDays, setProposalDays] = useState('');
  const [proposalCover, setProposalCover] = useState('');
  const [isGeneratingAIProposal, setIsGeneratingAIProposal] = useState(false);

  const [newGigTitle, setNewGigTitle] = useState('');
  const [newGigCat, setNewGigCat] = useState('Development & IT');
  const [newGigDesc, setNewGigDesc] = useState('');
  const [newGigPrice, setNewGigPrice] = useState(450);

  const [newGigDays, setNewGigDays] = useState(5);
  const [isOptimizingGig, setIsOptimizingGig] = useState(false);

  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjCat, setNewProjCat] = useState('Development & IT');
  const [newProjDesc, setNewProjDesc] = useState('');
  const [newProjMin, setNewProjMin] = useState(500);
  const [newProjMax, setNewProjMax] = useState(2000);

  // Active chat order selection
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [newMessageText, setNewMessageText] = useState('');

  // Workstream / People / Seller Profile state (PeoplePerHour style)
  const [workstreamTab, setWorkstreamTab] = useState<WorkstreamFilter>('all');
  const [activeWorkstreamSubTab, setActiveWorkstreamSubTab] = useState<'activity' | 'files'>('activity');
  const [workstreamSearch, setWorkstreamSearch] = useState('');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [projectFilterSearch, setProjectFilterSearch] = useState('');
  const [starredWorkstreams, setStarredWorkstreams] = useState<string[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('workstream_starred');
        return saved ? JSON.parse(saved) : [];
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('workstream_starred', JSON.stringify(starredWorkstreams));
      }
    } catch {}
  }, [starredWorkstreams]);

  const [selectedPersonFilter, setSelectedPersonFilter] = useState<string | null>(null);
  const [isStartWorkstreamModalOpen, setIsStartWorkstreamModalOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'gigs' | 'portfolio' | 'reviews' | 'endorsements'>('gigs');









  const [ticketReplyText, setTicketReplyText] = useState<string>('');
  const [disputeNotesText, setDisputeNotesText] = useState<string>('');

  // Freelance Activity view state
  const [freelanceTab, setFreelanceTab] = useState<'projects' | 'offers'>('offers');
  const [freelanceSubFilter, setFreelanceSubFilter] = useState<string>('All');
  const [activeFeatureDropdownGigId, setActiveFeatureDropdownGigId] = useState<string | null>(null);

  // User Notifications & Support Desk Modal State

  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isUserSwitchModalOpen, setIsUserSwitchModalOpen] = useState(false);
  const [likedGigIds, setLikedGigIds] = useState<string[]>([]);
  const [isWishlistModalOpen, setIsWishlistModalOpen] = useState(false);
  const [gigViewMode, setGigViewMode] = useState<'grid' | 'list'>('grid');
  const [isPuppetVideoPlaying, setIsPuppetVideoPlaying] = useState(false);

  const handleToggleLike = (gigId: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLikedGigIds(prev => 
      prev.includes(gigId) ? prev.filter(id => id !== gigId) : [...prev, gigId]
    );
  };

  // Auth & Verification States
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isSignupModalOpen, setIsSignupModalOpen] = useState(false);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [isForgotPasswordModalOpen, setIsForgotPasswordModalOpen] = useState(false);

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('');
  const [signupMobile, setSignupMobile] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupError, setSignupError] = useState<string | null>(null);
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyMobile, setVerifyMobile] = useState('');
  const [emailCodeInput, setEmailCodeInput] = useState('');
  const [smsCodeInput, setSmsCodeInput] = useState('');
  const [verificationMode, setVerificationMode] = useState<'email' | 'sms'>('email');
  const [mockEmailCodeDisplay, setMockEmailCodeDisplay] = useState('');
  const [mockSmsCodeDisplay, setMockSmsCodeDisplay] = useState('');

  const [forgotQuery, setForgotQuery] = useState('');
  const [forgotStep, setForgotStep] = useState<'request' | 'verify' | 'reset'>('request');
  const [forgotCode, setForgotCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [mockForgotCodeDisplay, setMockForgotCodeDisplay] = useState('');

  // 2FA / Device Verification Login States
  const [loginRequiresCode, setLoginRequiresCode] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [loginVerificationMessage, setLoginVerificationMessage] = useState('');




  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');

  // User Management State
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'suspended' | 'restricted'>('all');
  const [userRoleFilter, setUserRoleFilter] = useState('all');
  const [userVerifiedFilter, setUserVerifiedFilter] = useState<'all' | 'verified' | 'unverified'>('all');
  
  // Inspect & Edit User Modals
  const [inspectingUser, setInspectingUser] = useState<UserAccount | null>(null);
  const [userActivityTab, setUserActivityTab] = useState<'overview' | 'gigs' | 'projects' | 'proposals' | 'orders' | 'reviews' | 'tickets'>('overview');
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editUserForm, setEditUserForm] = useState({
    name: '',
    email: '',
    role: 'user',
    title: '',
    bio: '',
    skills: '',
    hourlyRate: 0,
    walletBalance: 0,
    verified: false,
    status: 'active'
  });
  
  // Category & Subcategory Management State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategorySlug, setNewCategorySlug] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [editCatSlug, setEditCatSlug] = useState('');
  const [addingSubForCatId, setAddingSubForCatId] = useState<string | null>(null);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [editingSubId, setEditingSubId] = useState<{ catId: string; subId: string } | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [selectedCatIds, setSelectedCatIds] = useState<string[]>([]);
  const [selectedSubPairs, setSelectedSubPairs] = useState<{ catId: string; subId: string }[]>([]);

  // Admin Projects Management State
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<'all' | 'open' | 'published' | 'unpublished' | 'suspended' | 'in_progress' | 'completed'>('all');
  const [projectCategoryFilter, setProjectCategoryFilter] = useState('all');
  const [projectFeaturedFilter, setProjectFeaturedFilter] = useState<'all' | 'featured' | 'regular'>('all');

  // Modals & Drawers for Projects Management
  const [viewingProject, setViewingProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjectForm, setEditProjectForm] = useState({
    title: '',
    category: '',
    subcategory: '',
    description: '',
    budgetMin: 0,
    budgetMax: 0,
    deadlineDays: 14,
    status: 'open' as Project['status'],
    featured: false
  });
  const [moderatingProject, setModeratingProject] = useState<Project | null>(null);
  const [moderationNotes, setModerationNotes] = useState('');
  const [moderationStatus, setModerationStatus] = useState<'approved' | 'flagged' | 'rejected' | 'pending'>('approved');

  // Admin Gigs Management State
  const [gigSearchQuery, setGigSearchQuery] = useState('');
  const [gigStatusFilter, setGigStatusFilter] = useState<'all' | 'published' | 'draft' | 'suspended'>('all');
  const [gigCategoryFilter, setGigCategoryFilter] = useState('all');
  const [gigFeaturedFilter, setGigFeaturedFilter] = useState<'all' | 'featured' | 'regular'>('all');

  // Modals & Drawers for Gigs Management
  const [viewingGig, setViewingGig] = useState<Gig | null>(null);
  const [editingGig, setEditingGig] = useState<Gig | null>(null);
  const [editGigForm, setEditGigForm] = useState({
    title: '',
    category: '',
    subcategory: '',
    description: '',
    price: 0,
    deliveryDays: 1,
    status: 'published' as Gig['status'],
    featured: false
  });
  const [moderatingGig, setModeratingGig] = useState<Gig | null>(null);
  const [gigModerationNotes, setGigModerationNotes] = useState('');
  const [gigModerationStatus, setGigModerationStatus] = useState<'approved' | 'flagged' | 'rejected' | 'pending'>('approved');
  const [gigToDelete, setGigToDelete] = useState<{ id: string; title?: string } | null>(null);
  const [deleteSuccessToast, setDeleteSuccessToast] = useState<string | null>(null);
  
  // Admin Proposals Management State
  const [proposalSearchQuery, setProposalSearchQuery] = useState('');
  const [proposalStatusFilter, setProposalStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [proposalSort, setProposalSort] = useState<'newest' | 'bid_high' | 'bid_low'>('newest');
  const [proposalBidMinFilter, setProposalBidMinFilter] = useState('');
  const [proposalBidMaxFilter, setProposalBidMaxFilter] = useState('');
  const [viewingProposal, setViewingProposal] = useState<Proposal | null>(null);
  const [editingProposal, setEditingProposal] = useState<Proposal | null>(null);
  const [editProposalForm, setEditProposalForm] = useState({
    bidAmount: 0,
    deliveryDays: 1,
    coverLetter: '',
    status: 'pending' as Proposal['status']
  });

  // Admin Orders Management State
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'all' | 'funded_in_escrow' | 'in_progress' | 'delivered' | 'completed' | 'disputed'>('all');
  const [orderGigFilter, setOrderGigFilter] = useState('all');
  const [orderProjectFilter, setOrderProjectFilter] = useState('all');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [associatingOrder, setAssociatingOrder] = useState<Order | null>(null);
  const [linkTargetType, setLinkTargetType] = useState<'gig' | 'project'>('gig');
  const [linkTargetId, setLinkTargetId] = useState('');

  // Gig Extras state
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [newGigExtras, setNewGigExtras] = useState<{ id: string; title: string; price: number }[]>([
    { id: 'ext_fast', title: 'Extra Fast Express Delivery', price: 100 }
  ]);
  const [extraTitleInput, setExtraTitleInput] = useState('');
  const [extraPriceInput, setExtraPriceInput] = useState(50);



  const handleAddGigExtra = () => {
    if (!extraTitleInput.trim() || extraPriceInput <= 0) return;
    setNewGigExtras(prev => [
      ...prev,
      { id: 'ext_' + Date.now(), title: extraTitleInput.trim(), price: Number(extraPriceInput) }
    ]);
    setExtraTitleInput('');
    setExtraPriceInput(50);
  };

  const handleRemoveGigExtra = (id: string) => {
    setNewGigExtras(prev => prev.filter(e => e.id !== id));
  };


  // Get Fiverr-style clean URL for a gig: /:username/:slug
  const getGigUrl = (gig: Gig) => {
    const uname = (gig.freelancerUsername || slugify(gig.freelancerName)).toLowerCase();
    const gslug = (gig.slug || slugify(gig.title)).toLowerCase();
    return `/${uname}/${gslug}`;
  };

  // Get clean URL for a project: /project/:slug
  const getProjectUrl = (project: Project) => {
    const pslug = (project.slug || slugify(project.title)).toLowerCase();
    return `/project/${pslug}`;
  };

  // Reserved top-level route segments
  const reservedRoutes = RESERVED_ROUTES;

  // Route matching
  const cleanPath = path.split('?')[0] || '/';
  const pathParts = cleanPath.split('/').filter(Boolean);

  const isCategoryRoute = cleanPath.startsWith('/categories/');
  const categorySlug = isCategoryRoute ? cleanPath.replace('/categories/', '').split('/')[0] : null;
  const currentCategory = categorySlug ? (SLUG_TO_CATEGORY[categorySlug] || 'All') : 'All';

  const isProjectsList = cleanPath === '/projects' || cleanPath === '/search-projects' || cleanPath === '/project-search' || cleanPath === '/freelance-jobs';
  const isFreelancersPage = cleanPath === '/freelancers' || cleanPath === '/search-freelancers' || cleanPath === '/freelancer-search';
  const isOrders = cleanPath === '/orders';
  const isMessages = cleanPath.startsWith('/messages') || cleanPath.startsWith('/workstream') || cleanPath.startsWith('/workstreams') || cleanPath.startsWith('/workspace');
  const messageOrderId = cleanPath.startsWith('/messages/') 
    ? cleanPath.split('/')[2] 
    : cleanPath.startsWith('/workstreams/') 
    ? cleanPath.split('/')[2] 
    : cleanPath.startsWith('/workstream/') 
    ? cleanPath.split('/')[2] 
    : cleanPath.startsWith('/workspace/') 
    ? cleanPath.split('/')[2] 
    : null;
  const isCreateGig = cleanPath === '/create-gig';
  const isPostProject = cleanPath === '/post-project';
  const isPayments = cleanPath.startsWith('/payments');
  const isAdmin = cleanPath === '/admin';
  const isSupport = cleanPath === '/support';
  const isSettings = cleanPath === '/settings';
  const isEditProfile = cleanPath === '/edit-profile' || cleanPath === '/freelancer/edit' || cleanPath === '/profile/edit' || (cleanPath.startsWith('/freelancer/') && cleanPath.endsWith('/edit')) || (cleanPath.startsWith('/profile/') && cleanPath.endsWith('/edit'));
  const isLoginRoute = cleanPath === '/login';
  const isSignupRoute = cleanPath === '/signup';
  const isForgotPasswordRoute = cleanPath === '/forgot-password';
  const isVerifyRoute = cleanPath === '/verify';
  const isWishlistRoute = cleanPath === '/wishlist';
  const isNotificationsRoute = cleanPath === '/notifications';
  const isSwitchUserRoute = cleanPath === '/switch-user';
  const isBuyerActivity = cleanPath === '/buyer-activity' || cleanPath === '/manage/projects' || cleanPath === '/buyer/activity';

  // Gig detail route check: Fiverr style /:username/:slug OR /gigs/:id
  let currentGig: Gig | undefined;
  let isGigDetail = false;

  if (pathParts.length === 2 && !reservedRoutes.includes(pathParts[0].toLowerCase())) {
    const usernameParam = pathParts[0].toLowerCase();
    const slugParam = pathParts[1].toLowerCase();

    currentGig = gigs.find(g => {
      const gigUsername = (g.freelancerUsername || slugify(g.freelancerName)).toLowerCase();
      const gigSlug = (g.slug || slugify(g.title)).toLowerCase();
      const matchUser = gigUsername === usernameParam || slugify(g.freelancerName).toLowerCase() === usernameParam || (g.freelancerId && g.freelancerId.toLowerCase() === usernameParam);
      const matchSlug = gigSlug === slugParam || g.id.toLowerCase() === slugParam;
      return matchUser && matchSlug;
    });

    if (!currentGig && initialData?.gig) {
      const initG = initialData.gig;
      const gigUsername = (initG.freelancerUsername || slugify(initG.freelancerName)).toLowerCase();
      const gigSlug = (initG.slug || slugify(initG.title)).toLowerCase();
      const matchUser = gigUsername === usernameParam || slugify(initG.freelancerName).toLowerCase() === usernameParam;
      const matchSlug = gigSlug === slugParam || initG.id.toLowerCase() === slugParam;
      if (matchUser && matchSlug) currentGig = initG;
    }

    if (currentGig) {
      isGigDetail = true;
    }
  } else if (cleanPath.startsWith('/gigs/') && cleanPath.length > 6) {
    const gigIdParam = cleanPath.replace('/gigs/', '').toLowerCase();
    currentGig = gigs.find(g => g.id.toLowerCase() === gigIdParam || (g.slug && g.slug.toLowerCase() === gigIdParam));
    if (!currentGig && initialData?.gig && (initialData.gig.id.toLowerCase() === gigIdParam || (initialData.gig.slug && initialData.gig.slug.toLowerCase() === gigIdParam))) {
      currentGig = initialData.gig;
    }
    if (currentGig) {
      isGigDetail = true;
    }
  }

  let isProfilePage = false;
  let profileUserUsername: string | null = null;
  if (!isGigDetail) {
    if (pathParts.length === 1 && !reservedRoutes.includes(pathParts[0].toLowerCase())) {
      profileUserUsername = pathParts[0].toLowerCase();
      isProfilePage = true;
    } else if ((cleanPath.startsWith('/profile/') || cleanPath.startsWith('/freelancers/')) && pathParts.length >= 2) {
      profileUserUsername = pathParts[1].toLowerCase();
      isProfilePage = true;
    }
  }

  const profileUser = isProfilePage 
    ? (usersList.find(u => {
        if (!profileUserUsername) return false;
        const target = profileUserUsername.toLowerCase();
        return (u.username && u.username.toLowerCase() === target) ||
               (u.name && slugify(u.name).toLowerCase() === target) ||
               (u.name && u.name.toLowerCase() === target) ||
               (u.id && u.id.toLowerCase() === target);
      }) || (initialData?.profileUser) || (impersonatedUser || currentUser || usersList[0]))
    : null;

  const isGigsList = (cleanPath === '/gigs' || cleanPath === '/' || isCategoryRoute) && !isGigDetail && !isProfilePage && !isEditProfile && !isSettings && !isProjectsList && !isFreelancersPage && !isOrders && !isMessages && !isCreateGig && !isPostProject && !isPayments && !isAdmin && !isSupport && !isBuyerActivity;

  // Sync pathname route
  useEffect(() => {
    const handlePopState = () => {
      const newPath = window.location.pathname || '/';
      setPath(newPath);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);


  // Sync selected order and query filters for messages deep link
  useEffect(() => {
    if (messageOrderId && orders.length > 0) {
      const ord = orders.find(o => o.id === messageOrderId);
      if (ord) {
        setSelectedOrder(ord);
        fetchMessages(ord.id);
      }
    } else if (path.startsWith('/messages') || path.startsWith('/workstreams')) {
      const queryIdx = path.indexOf('?');
      if (queryIdx !== -1) {
        const params = new URLSearchParams(path.slice(queryIdx));
        const contactParam = params.get('contact');
        if (contactParam) setSelectedPersonFilter(contactParam);
        const tabParam = params.get('tab');
        if (tabParam) setWorkstreamTab(tabParam as WorkstreamFilter);
        const projParam = params.get('project');
        if (projParam) setProjectFilterSearch(projParam);
        const searchParam = params.get('q');
        if (searchParam) setWorkstreamSearch(searchParam);
      }
      if (!messageOrderId) {
        setSelectedOrder(null);
      }
    }
  }, [messageOrderId, orders, path]);

  const navigate = (to: string, e?: React.MouseEvent | MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', to);
      setPath(to);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Intercept all internal anchor clicks across the entire site
  useEffect(() => {
    const handleGlobalAnchorClick = (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a');
      if (!anchor) return;
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;

      if (href.startsWith('/') && !href.startsWith('//')) {
        e.preventDefault();
        navigate(href, e);
      } else if (typeof window !== 'undefined' && href.startsWith(window.location.origin + '/')) {
        const localPath = href.slice(window.location.origin.length);
        e.preventDefault();
        navigate(localPath, e);
      }
    };

    document.addEventListener('click', handleGlobalAnchorClick);
    return () => document.removeEventListener('click', handleGlobalAnchorClick);
  }, [currentUser]);

  const { 
    hydratedWorkstreamItems, 
    filteredWorkstreamItems,
    selectedOrder: hookSelectedOrder, 
    setSelectedOrder: hookSetSelectedOrder, 
    messages: hookMessages, 
    setMessages: hookSetMessages,
    activeSharedFiles: hookActiveSharedFiles,
    newMessageText: hookNewMessageText, 
    setNewMessageText: hookSetNewMessageText, 
    fetchMessages,
    handleReleaseEscrow,
    handleDeliverWork,
    handleRequestRevision,
    handleStartWorkstreamModalSubmit,
    wsRef,
    sendMessage,
    retryMessage,
    sendEvent,
    isReviewModalOpen,
    setIsReviewModalOpen,
    handleSubmitReview,
    reviewError,
    isSubmittingReview,
    escrowError
  } = useWorkstream({ 
    orders, usersList, gigs, messages, currentUser, impersonatedUser,
    workstreamTab, starredWorkstreams, selectedPersonFilter, projectFilterSearch, workstreamSearch,
    projects,
    setOrders, setSelectedOrder, setIsStartWorkstreamModalOpen, navigate, financeLedger,
    selectedOrder, setNewMessageText, setMessages, setReviews: setAppReviews, refresh
  });

  // Fetch initial data & restore user session
  useEffect(() => {
    if (window.location.pathname === '/messages' && !getAuthToken()) {
      setPath('/');
      window.history.replaceState({}, '', '/');
      setIsLoginModalOpen(true);
    }
    const token = getAuthToken();
    if (token) {
      loadUserSession();
    } else if (!initialData?.gigs?.length) {
      refresh();
    }
  }, []);

  // Keep messages in sync whenever selected order changes
  useEffect(() => {
    if (selectedOrder?.id) {
      fetchMessages(selectedOrder.id);
    }
  }, [selectedOrder?.id]);


  const safeJson = async (res: Response, fallback: any = []) => {
    if (!res.ok) return fallback;
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) return fallback;
    try {
      return await res.json();
    } catch {
      return fallback;
    }
  };

  const loadUserSession = async (): Promise<boolean> => {
    const token = getAuthToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status === 401) {
          clearAuthToken();
          updateCurrentUser(null);
        }
        return false;
      }
      const data = await res.json();
      if (data.user) {
        updateCurrentUser(data.user);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  const activeUserId = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : null);
  useEffect(() => {
    if (activeUserId) {
      fetchUserEmails(activeUserId);
      refresh();
    }
  }, [activeUserId]);

  const handleContactSeller = async (sellerId: string, sellerName: string, gigTitle: string, gigId?: string, projectId?: string) => {
    const currentUid = impersonatedUser ? impersonatedUser.id : currentUser?.id;
    
    // 1. Search for existing conversation between current user and this seller for this specific gig/project
    // Finished or cancelled orders are not reused: the buyer gets a fresh inquiry instead of a closed thread.
    let existingOrder = orders.find(o => 
      (o.buyerId === currentUid && o.sellerId === sellerId) &&
      !['completed', 'cancelled'].includes(o.status) &&
      (gigId ? o.gigId === gigId : (projectId ? o.projectId === projectId : (!o.gigId && !o.projectId)))
    );
    
    if (existingOrder) {
      setSelectedOrder(existingOrder);
      await fetchMessages(existingOrder.id);
      navigate(`/messages/${existingOrder.id}`);
    } else {
      if (!currentUser) {
        setIsLoginModalOpen(true);
        return;
      }
      // 2. Create an inquiry conversation thread and send initial greeting message
      try {
        const currentUname = impersonatedUser ? impersonatedUser.name : currentUser.name;
        const token = getAuthToken();
        const authHeaders = {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };

        const res = await fetchWithRetry('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            title: `Inquiry: ${gigTitle}`,
            buyerId: currentUid,
            sellerId: sellerId,
            gigId,
            projectId,
            amount: 0,
            dueDate: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
          })
        });
        
        const resData = await res.json();
        if (!res.ok) {
          window.alert(resData.error || 'Failed to start conversation.');
          return;
        }

        const newChatOrd = resData;
        setOrders(prev => [newChatOrd, ...prev]);
        setSelectedOrder(newChatOrd);

        // Send initial inquiry message
        const initText = `Hi ${sellerName}, I am interested in ${gigId ? `your gig: "${gigTitle}"` : `your project`}. Let's discuss details!`;
        await fetchWithRetry('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            orderId: newChatOrd.id,
            senderId: currentUid,
            senderName: currentUname,
            text: initText
          })
        });
        await fetchMessages(newChatOrd.id);
        navigate(`/messages/${newChatOrd.id}`);
      } catch (err) {
        console.error('Error creating contact chat:', err);
      }
    }
  };

  // Category Management Handlers
  const handleToggleCategory = async (catId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}/toggle`, { method: 'PATCH' });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleSubcategory = async (catId: string, subId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}/subcategories/${subId}/toggle`, { method: 'PATCH' });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleBulkDeleteCategories = async () => {
    const totalCount = selectedCatIds.length + selectedSubPairs.length;
    if (totalCount === 0) return;
    if (!confirm(`Are you sure you want to bulk delete ${totalCount} selected items?`)) return;

    try {
      const res = await fetchWithRetry('/api/admin/categories/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({
          categoryIds: selectedCatIds,
          subcategoryPairs: selectedSubPairs
        })
      });
      const data = await safeJson(res, null);
      if (data) {
        setCategories(data);
        setSelectedCatIds([]);
        setSelectedSubPairs([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await fetchWithRetry('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newCategoryName.trim(), slug: newCategorySlug.trim() })
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
      setNewCategoryName('');
      setNewCategorySlug('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateCategory = async (catId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editCatName.trim(), slug: editCatSlug.trim() })
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
      setEditingCatId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteCategory = async (catId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete category "${name}" and its subcategories?`)) return;
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}`, {
        method: 'DELETE'
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddSubcategory = async (catId: string) => {
    if (!newSubcategoryName.trim()) return;
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}/subcategories`, {
        method: 'POST',
        body: JSON.stringify({ name: newSubcategoryName.trim() })
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
      setAddingSubForCatId(null);
      setNewSubcategoryName('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateSubcategory = async (catId: string, subId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}/subcategories/${subId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editSubName.trim() })
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
      setEditingSubId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteSubcategory = async (catId: string, subId: string, subName: string) => {
    if (!confirm(`Delete subcategory "${subName}"?`)) return;
    try {
      const res = await fetchWithRetry(`/api/admin/categories/${catId}/subcategories/${subId}`, {
        method: 'DELETE'
      });
      const data = await safeJson(res, null);
      if (data) setCategories(data);
    } catch (err) {
      console.error(err);
    }
  };

  // Impersonation handlers
  const handleStartImpersonation = async (user: UserAccount) => {
    try {
      await fetchWithRetry(`/api/admin/users/${user.id}/impersonate`, { method: 'POST' });
      setImpersonatedUser(user);
      fetchUserEmails(user.id);
      refresh();
      alert(`Started Super Admin Impersonation of ${user.name}. Security notice sent via chat and email.`);
      navigate('/gigs');
    } catch (e) {
      console.error(e);
      setImpersonatedUser(user);
      navigate('/gigs');
    }
  };

  const handleStopImpersonation = async () => {
    if (impersonatedUser) {
      try {
        await fetchWithRetry(`/api/admin/users/${impersonatedUser.id}/stop-impersonate`, { method: 'POST' });
      } catch (err) {
        console.error('Error stopping impersonation on backend:', err);
      }
    }
    setImpersonatedUser(null);
    if (currentUser) fetchUserEmails(currentUser.id);
    refresh();
    alert('Impersonation ended. Returned to Admin Console.');
    navigate('/admin');
  };

  const handleOpenEditUserModal = (user: UserAccount) => {
    setEditingUser(user);
    setEditUserForm({
      name: user.name || '',
      email: user.email || '',
      role: user.role || 'user',
      title: user.title || '',
      bio: user.bio || '',
      skills: Array.isArray(user.skills) ? user.skills.join(', ') : '',
      hourlyRate: user.hourlyRate || 0,
      walletBalance: user.walletBalance || 0,
      verified: !!user.verified,
      status: user.status || 'active'
    });
  };

  const handleSaveEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const res = await fetchWithRetry(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editUserForm)
      });
      const updated = await res.json();
      setUsersList(prev => prev.map(u => u.id === editingUser.id ? updated : u));
      if (inspectingUser?.id === editingUser.id) setInspectingUser(updated);
      setEditingUser(null);
      alert(`Updated user profile for ${updated.name}`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleUserVerify = async (id: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/users/${id}/verify`, { method: 'PATCH' });
      const updated = await res.json();
      setUsersList(prev => prev.map(u => u.id === id ? updated : u));
      if (inspectingUser?.id === id) setInspectingUser(updated);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUserStatusToggle = async (id: string, newStatus: 'active' | 'suspended' | 'restricted') => {
    try {
      const targetUser = usersList.find(u => u.id === id);
      const res = await fetchWithRetry(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      const updated = await res.json();
      setUsersList(prev => prev.map(u => u.id === id ? updated : u));
      if (inspectingUser?.id === id) setInspectingUser(updated);
      if (newStatus === 'suspended' || newStatus === 'restricted') {
        alert(`User ${targetUser?.name || id} status changed to ${newStatus.toUpperCase()}. Automated Chat message and Email notification dispatched asking to contact support.`);
      } else {
        alert(`User ${targetUser?.name || id} activated successfully.`);
      }
      refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to permanently delete this user account? All associated freelance gigs and buyer project postings will also be deleted. This action is irreversible.')) return;
    try {
      await fetchWithRetry(`/api/admin/users/${userId}`, { method: 'DELETE' });
      setUsersList(prev => prev.filter(u => u.id !== userId));
      if (inspectingUser?.id === userId) setInspectingUser(null);
      alert('User account and all associated listings permanently deleted.');
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Admin Projects Management Handlers
  const handleUpdateProjectStatus = async (projectId: string, newStatus: Project['status']) => {
    try {
      const res = await fetchWithRetry(`/api/admin/projects/${projectId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      const updated = await res.json();
      setProjects(prev => prev.map(p => p.id === projectId ? updated : p));
      if (viewingProject?.id === projectId) setViewingProject(updated);
      if (editingProject?.id === projectId) setEditingProject(updated);
      if (moderatingProject?.id === projectId) setModeratingProject(updated);
      alert(`Project status updated to "${newStatus.toUpperCase()}".`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleProjectFeature = async (projectId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/projects/${projectId}/feature`, { method: 'PATCH' });
      const updated = await res.json();
      setProjects(prev => prev.map(p => p.id === projectId ? updated : p));
      if (viewingProject?.id === projectId) setViewingProject(updated);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenEditProjectModal = (p: Project) => {
    setEditingProject(p);
    setEditProjectForm({
      title: p.title || '',
      category: p.category || 'Development & IT',
      subcategory: p.subcategory || '',
      description: p.description || '',
      budgetMin: p.budgetMin || 0,
      budgetMax: p.budgetMax || 0,
      deadlineDays: p.deadlineDays || 14,
      status: p.status || 'open',
      featured: !!p.featured
    });
  };

  const handleSaveEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    try {
      const res = await fetch(`/api/admin/projects/${editingProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editProjectForm)
      });
      const updated = await res.json();
      setProjects(prev => prev.map(p => p.id === editingProject.id ? updated : p));
      setEditingProject(null);
      alert(`Project "${updated.title}" updated successfully.`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenModerationModal = (p: Project) => {
    setModeratingProject(p);
    setModerationStatus(p.moderationStatus || 'approved');
    setModerationNotes(p.moderationNotes || '');
  };

  const handleSaveModeration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moderatingProject) return;
    try {
      const res = await fetch(`/api/admin/projects/${moderatingProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moderationStatus,
          moderationNotes
        })
      });
      const updated = await res.json();
      setProjects(prev => prev.map(p => p.id === moderatingProject.id ? updated : p));
      setModeratingProject(null);
      alert(`Moderation review recorded for project "${updated.title}".`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to permanently delete this project?')) return;
    try {
      await fetch(`/api/admin/projects/${projectId}`, { method: 'DELETE' });
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (viewingProject?.id === projectId) setViewingProject(null);
      alert('Project deleted successfully.');
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Admin Gigs / Services Management Handlers
  const handleUpdateGigStatus = async (gigId: string, newStatus: Gig['status']) => {
    try {
      const res = await fetchWithRetry(`/api/admin/gigs/${gigId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      const updated = await res.json();
      setGigs(prev => prev.map(g => g.id === gigId ? updated : g));
      if (viewingGig?.id === gigId) setViewingGig(updated);
      alert(`Service status updated to "${newStatus.toUpperCase()}".`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleGigFeature = async (gigId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/gigs/${gigId}/feature`, { method: 'PATCH' });
      const updated = await res.json();
      setGigs(prev => prev.map(g => g.id === gigId ? updated : g));
      if (viewingGig?.id === gigId) setViewingGig(updated);
      alert(`Service featured status toggled!`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenEditGigModal = (g: Gig) => {
    setEditingGig(g);
    setEditGigForm({
      title: g.title || '',
      category: g.category || 'Development & IT',
      subcategory: g.subcategory || '',
      description: g.description || '',
      price: g.price || 0,
      deliveryDays: g.deliveryDays || 1,
      status: g.status || 'published',
      featured: !!g.featured
    });
  };

  const handleSaveEditGig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGig) return;
    try {
      let updatedGig = { ...editingGig, ...editGigForm };
      try {
        const res = await fetchWithRetry(`/api/gigs/${editingGig.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editGigForm)
        });
        if (res.ok) {
          updatedGig = await res.json();
        }
      } catch (err) {
        console.warn('Gig patch error:', err);
      }
      try {
        await fetchWithRetry(`/api/admin/gigs/${editingGig.id}`, {
          method: 'PATCH',
          body: JSON.stringify(editGigForm)
        });
      } catch (e) {
        // admin fallback
      }
      setGigs(prev => prev.map(g => g.id === editingGig.id ? updatedGig : g));
      if (viewingGig?.id === editingGig.id) setViewingGig(updatedGig);
      setEditingGig(null);
      setDeleteSuccessToast(`Gig "${updatedGig.title}" updated successfully.`);
      setTimeout(() => setDeleteSuccessToast(null), 3500);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenGigModerationModal = (g: Gig) => {
    setModeratingGig(g);
    setGigModerationStatus(g.moderationStatus || 'approved');
    setGigModerationNotes(g.moderationNotes || '');
  };

  const handleSaveGigModeration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moderatingGig) return;
    try {
      const res = await fetchWithRetry(`/api/admin/gigs/${moderatingGig.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          moderationStatus: gigModerationStatus,
          moderationNotes: gigModerationNotes
        })
      });
      const updated = await res.json();
      setGigs(prev => prev.map(g => g.id === moderatingGig.id ? updated : g));
      setModeratingGig(null);
      alert(`Moderation review recorded for service/gig "${updated.title}".`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteGig = (gigId: string, gigTitle?: string) => {
    const gig = gigs.find(g => g.id === gigId);
    setGigToDelete({ id: gigId, title: gigTitle || gig?.title });
  };

  const handleConfirmDeleteGig = async () => {
    if (!gigToDelete) return;
    const gigId = gigToDelete.id;
    const gigTitle = gigToDelete.title;
    setGigToDelete(null);

    if (viewingGig?.id === gigId) setViewingGig(null);
    if (editingGig?.id === gigId) setEditingGig(null);

    setGigs(prev => prev.filter(g => g.id !== gigId));

    try {
      await fetchWithRetry(`/api/gigs/${gigId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Delete gig error:', e);
    }
    try {
      await fetchWithRetry(`/api/admin/gigs/${gigId}`, { method: 'DELETE' });
    } catch (e) {
      // admin fallback
    }

    setDeleteSuccessToast(`Gig "${gigTitle || 'Service'}" deleted successfully.`);
    setTimeout(() => {
      setDeleteSuccessToast(null);
    }, 4000);

    refresh();
  };

  const handleOpenEditProposalModal = (p: Proposal) => {
    setEditingProposal(p);
    setEditProposalForm({
      bidAmount: p.bidAmount,
      deliveryDays: p.deliveryDays,
      coverLetter: p.coverLetter,
      status: p.status
    });
  };

  const handleSaveEditProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProposal) return;
    try {
      const res = await fetchWithRetry(`/api/admin/proposals/${editingProposal.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editProposalForm)
      });
      const updated = await res.json();
      setProposals(prev => prev.map(p => p.id === editingProposal.id ? updated : p));
      setEditingProposal(null);
      alert(`Proposal #${updated.id} updated successfully.`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateProposalStatus = async (proposalId: string, newStatus: Proposal['status']) => {
    try {
      const res = await fetchWithRetry(`/api/admin/proposals/${proposalId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      const updated = await res.json();
      setProposals(prev => prev.map(p => p.id === proposalId ? updated : p));
      alert(`Proposal status updated to ${newStatus}.`);
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProposal = async (proposalId: string) => {
    if (!confirm('Are you sure you want to permanently delete this proposal? This action is irreversible.')) return;
    try {
      await fetchWithRetry(`/api/admin/proposals/${proposalId}`, { method: 'DELETE' });
      setProposals(prev => prev.filter(p => p.id !== proposalId));
      if (viewingProposal?.id === proposalId) setViewingProposal(null);
      alert('Proposal deleted successfully.');
      refresh();
    } catch (err) {
      console.error(err);
    }
  };

  // Authentication & Verification Action Handlers

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);

    if (signupPassword !== signupConfirmPassword) {
      setSignupError('Passwords do not match. Please ensure both password fields are identical.');
      return;
    }
    if (signupPassword.length < 6) {
      setSignupError('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmittingSignup(true);
    try {
      const res = await fetchWithRetry('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          email: signupEmail.trim(),
          password: signupPassword,
          confirmPassword: signupConfirmPassword,
          mobile: signupMobile.trim(),
          name: signupName.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      if (data.token) setAuthToken(data.token);
      if (data.user) {
        updateCurrentUser(data.user);
        setImpersonatedUser(null);
      }
      setVerifyEmail(signupEmail.trim());
      setVerifyMobile(signupMobile.trim());
      setSignupPassword('');
      setSignupConfirmPassword('');
      const emailCode = data.mockEmailCode || '';
      const smsCode = data.mockSmsCode || '';
      setMockEmailCodeDisplay(emailCode);
      setMockSmsCodeDisplay(smsCode);
      if (emailCode) setEmailCodeInput(emailCode);
      if (smsCode) setSmsCodeInput(smsCode);
      setIsSignupModalOpen(false);
      setIsVerifyModalOpen(true);
      if (window.location.pathname === '/signup') {
        navigate('/verify');
      }
    } catch (err: any) {
      setSignupError(err.message || 'Signup failed. Please try again.');
    } finally {
      setIsSubmittingSignup(false);
    }
  };

  const handleVerifyEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithRetry('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ email: verifyEmail, code: emailCodeInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      if (currentUser) {
        updateCurrentUser(prev => prev ? { ...prev, verified: true, emailVerified: true } : null);
      }
      setIsVerifyModalOpen(false);
      refresh();
      if (window.location.pathname === '/signup' || window.location.pathname === '/login' || window.location.pathname === '/verify') {
        navigate('/');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleResendEmailCode = async () => {
    try {
      const res = await fetchWithRetry('/api/auth/resend-email-code', {
        method: 'POST',
        body: JSON.stringify({ email: verifyEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resend failed');
      const newCode = data.mockEmailCode || '';
      setMockEmailCodeDisplay(newCode);
      if (newCode) setEmailCodeInput(newCode);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleVerifySmsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithRetry('/api/auth/verify-sms', {
        method: 'POST',
        body: JSON.stringify({ mobile: verifyMobile, code: smsCodeInput })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'SMS verification failed');
      if (currentUser) {
        updateCurrentUser(prev => prev ? { ...prev, verified: true, mobileVerified: true } : null);
      }
      setIsVerifyModalOpen(false);
      refresh();
      if (window.location.pathname === '/signup' || window.location.pathname === '/login' || window.location.pathname === '/verify') {
        navigate('/');
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleResendSmsCode = async () => {
    try {
      const res = await fetchWithRetry('/api/auth/resend-sms-code', {
        method: 'POST',
        body: JSON.stringify({ mobile: verifyMobile })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Resend SMS failed');
      const newCode = data.mockSmsCode || '';
      setMockSmsCodeDisplay(newCode);
      if (newCode) setSmsCodeInput(newCode);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleLoginSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setLoginError(null);
    setIsSubmittingLogin(true);
    try {
      let deviceId = 'unknown';
      try {
        deviceId = getDeviceId();
      } catch (e) {
        console.warn('Could not get device ID', e);
      }
      
      const payload: any = {
        email: loginEmail,
        password: loginPassword,
        deviceId
      };
      if (loginRequiresCode && loginCode.trim()) {
        payload.code = loginCode.trim();
      }

      const res = await fetchWithRetry('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Invalid email or password. Please check your credentials.');
      }

      if (data.requiresVerification) {
        setLoginRequiresCode(true);
        setLoginVerificationMessage(data.message || 'Verification code sent to your registered email.');
        if (data.mockEmailCode) {
          setMockEmailCodeDisplay(data.mockEmailCode);
          setLoginCode(data.mockEmailCode);
        }
        return;
      }

      if (data.token) {
        setAuthToken(data.token);
      }
      if (data.user) {
        updateCurrentUser(data.user);
        setImpersonatedUser(null);
      }
      setIsLoginModalOpen(false);
      setLoginRequiresCode(false);
      setLoginCode('');
      setLoginEmail('');
      setLoginPassword('');
      setLoginError(null);
      refresh();
      if (window.location.pathname === '/login' || window.location.pathname === '/signup') {
        navigate('/');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed. Please check your email and password.');
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleLogout = () => {
    setImpersonatedUser(null);
    updateCurrentUser(null);
    clearAuthToken();
    localStorage.removeItem('user');
    localStorage.removeItem('current_user');
    setLoginEmail('');
    setLoginPassword('');
    setLoginError(null);
    setOrders([]);
    setMessages([]);
    setSelectedOrder(null);
    setSelectedPersonFilter(null);
    setWorkstreamSearch('');
    setProjectFilterSearch('');
    setWorkstreamTab('all');
    setLikedGigIds([]);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    navigate('/login');
  };

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithRetry('/api/auth/forgot-password/request', {
        method: 'POST',
        body: JSON.stringify({ emailOrMobile: forgotQuery })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setMockForgotCodeDisplay(data.mockRecoveryCode || '');
      setForgotStep('verify');
      alert('Recovery code sent.');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleForgotVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetchWithRetry('/api/auth/forgot-password/verify', {
        method: 'POST',
        body: JSON.stringify({ emailOrMobile: forgotQuery, code: forgotCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      setForgotStep('reset');
      alert('Code verified successfully. Enter new password.');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      alert('Passwords do not match. Please re-enter confirm password.');
      return;
    }
    try {
      const res = await fetchWithRetry('/api/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({ emailOrMobile: forgotQuery, code: forgotCode, newPassword, confirmPassword: confirmNewPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed');
      alert('Password reset successfully! Please log in with your new password.');
      setIsForgotPasswordModalOpen(false);
      setForgotStep('request');
      setForgotCode('');
      setNewPassword('');
      setConfirmNewPassword('');
      setIsLoginModalOpen(true);
    } catch (err: any) {
      alert(err.message);
    }
  };








  const handleResolveDispute = async (id: string, resolutionStatus: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/disputes/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ status: resolutionStatus, notes: disputeNotesText || 'Resolved by Super Admin.' })
      });
      const updated = await res.json();
      setDisputes(prev => prev.map(d => d.id === id ? updated : d));
      setDisputeNotesText('');
      alert(`Dispute #${id} resolved successfully.`);
      refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSupportReply = async (ticketId: string) => {
    if (!ticketReplyText.trim()) return;
    try {
      const res = await fetchWithRetry(`/api/admin/tickets/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text: ticketReplyText })
      });
      const updated = await res.json();
      setSupportTickets(prev => prev.map(t => t.id === ticketId ? updated : t));
      setTicketReplyText('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateSupportTicket = async (e: React.FormEvent, isAppealExplicit?: boolean) => {
    e.preventDefault();
    if (!supportSubject.trim() || !supportMessage.trim()) return;
    try {
      const activeUserId = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : '');
      const isAppeal = Boolean(
        isAppealExplicit ||
        currentUser?.status === 'suspended' ||
        currentUser?.status === 'restricted' ||
        supportSubject.toLowerCase().includes('appeal')
      );
      const res = await fetchWithRetry('/api/support-tickets', {
        method: 'POST',
        headers: { 'x-user-id': activeUserId },
        body: JSON.stringify({
          subject: supportSubject,
          text: supportMessage,
          priority: isAppeal ? 'high' : 'medium',
          isAppeal,
          category: isAppeal ? 'appeal' : 'general'
        })
      });
      if (res.ok) {
        const newTicket = await res.json();
        setSupportTickets(prev => [newTicket, ...prev]);
        setSupportSubject('');
        setSupportMessage('');
        setIsSupportModalOpen(false);
      } else {
        const errData = await res.json().catch(() => ({}));
        if (errData.error) {
          alert(errData.error);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleApprovePayout = async (payoutId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/payouts/${payoutId}/approve`, { method: 'PATCH' });
      const updated = await res.json();
      setPayouts(prev => prev.map(p => p.id === payoutId ? updated : p));
      refresh();
    } catch (e) {
      console.error(e);
    }
  };
  const handleProcessPayout = async (payoutId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/payouts/${payoutId}/process`, { method: 'PATCH' });
      const updated = await res.json();
      setPayouts(prev => prev.map(p => p.id === payoutId ? updated : p));
      refresh();
    } catch (e) {
      console.error(e);
    }
  };
  const handleFailPayout = async (payoutId: string) => {
    try {
      const res = await fetchWithRetry(`/api/admin/payouts/${payoutId}/fail`, { method: 'PATCH' });
      const updated = await res.json();
      setPayouts(prev => prev.map(p => p.id === payoutId ? updated : p));
      refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateOrder = async (title: string, amount: number, sellerId: string, gigId?: string, extraIds?: string[]) => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetchWithRetry('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          title,
          buyerId: impersonatedUser ? impersonatedUser.id : currentUser.id,
          sellerId,
          amount, // ignored by the server for gig orders: it prices the order from gigId + extraIds
          gigId,
          extraIds,
          dueDate: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0]
        })
      });
      let newOrd: any;
      try {
        newOrd = await res.json();
      } catch {
        window.alert('Could not place the order. Please try again.');
        return;
      }
      if (!res.ok) {
        // e.g. insufficient wallet balance: nothing was created or charged
        let errText = newOrd?.error || 'Could not place the order.';
        if (errText.includes('Insufficient')) {
          errText += ' Add funds to your wallet and try again.';
        }
        window.alert(errText);
        return;
      }
      setOrders(prev => [newOrd, ...prev]);
      setSelectedOrder(newOrd);
      fetchMessages(newOrd.id);
      refresh();
      navigate(`/messages/${newOrd.id}`);
    } catch (err) {
      console.error(err);
      window.alert('Network error while placing the order. Please try again.');
    }
  };

  const handleAttachMockFile = async () => {
    if (!selectedOrder) return;
    const mockFiles = [
      { name: 'project_brief.pdf', size: '1.2 MB', url: '#' },
      { name: 'logo_assets.zip', size: '45.8 MB', url: '#' },
      { name: 'ui_mockup_v1.fig', size: '8.4 MB', url: '#' },
      { name: 'database_schema.sql', size: '12 KB', url: '#' }
    ];
    const randomFile = mockFiles[Math.floor(Math.random() * mockFiles.length)];
    
    const currentUid = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : '');
    const currentUname = impersonatedUser ? impersonatedUser.name : (currentUser ? currentUser.name : 'Guest');

    const token = getAuthToken();
    try {
      await fetchWithRetry(`/api/orders/${selectedOrder.id}/message`, {
        method: 'POST',
        body: JSON.stringify({
          text: `Uploaded file: ${randomFile.name}`,
          type: 'file',
          fileInfo: randomFile
        })
      });
      fetchMessages(selectedOrder.id);
    } catch (err) {
      console.error('Error attaching file:', err);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessageText.trim() || !selectedOrder) return;

    const currentUid = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : '');
    const currentUname = impersonatedUser ? impersonatedUser.name : (currentUser ? currentUser.name : 'Guest');

    try {
      const token = getAuthToken();
      await fetchWithRetry(`/api/orders/${selectedOrder.id}/message`, {
        method: 'POST',
        body: JSON.stringify({ orderId: selectedOrder.id, text: newMessageText, type: 'message' })
      });
      fetchMessages(selectedOrder.id);
    } catch (err) {
      console.error('Error sending message:', err);
    }

    setNewMessageText('');
  };

  const handleGenerateAIProposal = async (projectTitle: string, projectDesc: string) => {
    const currentUname = impersonatedUser ? impersonatedUser.name : (currentUser ? currentUser.name : 'Freelance Specialist');
    setProposalCover(`Dear Client,\n\nI am thrilled to submit my proposal for "${projectTitle}". With extensive experience as a Senior Full-Stack Architect specializing in scalable web applications, secure escrow workflows, and high-performance React/TypeScript systems, I am confident in delivering exceptional results.\n\nProject Understanding: "${projectDesc.substring(0, 100)}..."\n\nI propose a robust architecture with continuous updates and 100% escrow protection. I am ready to start immediately.\n\nBest regards,\n${currentUname}`);
  };

  const handleSubmitProposal = async (e: React.FormEvent, projectId: string) => {
    e.preventDefault();
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetchWithRetry('/api/proposals', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          freelancerId: impersonatedUser ? impersonatedUser.id : currentUser.id,
          freelancerName: impersonatedUser ? impersonatedUser.name : currentUser.name,
          freelancerAvatar: impersonatedUser ? impersonatedUser.avatar : currentUser.avatar,
          freelancerTitle: currentUser.title,
          coverLetter: proposalCover,
          bidAmount: Number(proposalBid),
          deliveryDays: Number(proposalDays)
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to submit proposal.');
        return;
      }
      setProposalCover('');
      setProposalBid('');
      setProposalDays('');
      await refresh();
      if (data.workstreamOrderId) {
        alert('Proposal submitted! A private chat with the client has been opened.');
        navigate(`/messages/${data.workstreamOrderId}`);
      } else {
        alert('Proposal submitted successfully!');
        navigate('/projects');
      }
    } catch (err: any) {
      alert(err?.message || 'Error submitting proposal');
    }
  };

  const handleSubmitProposalDirect = async (projectId: string, bidAmount: number, deliveryDays: number, coverLetter: string) => {
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetchWithRetry('/api/proposals', {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          freelancerId: impersonatedUser ? impersonatedUser.id : currentUser.id,
          freelancerName: impersonatedUser ? impersonatedUser.name : currentUser.name,
          freelancerAvatar: impersonatedUser ? impersonatedUser.avatar : currentUser.avatar,
          freelancerTitle: currentUser.title || 'Freelance Specialist',
          coverLetter,
          bidAmount,
          deliveryDays
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to submit proposal.');
        return;
      }
      await refresh();
      if (data.workstreamOrderId) {
        alert('Proposal submitted! A private chat with the client has been opened.');
        navigate(`/messages/${data.workstreamOrderId}`);
      } else {
        alert('Proposal submitted successfully!');
      }
    } catch (err: any) {
      alert(err?.message || 'Error submitting proposal');
    }
  };

  const handleFeatureUserGig = async (gigId: string) => {
    setGigs(prev => {
      const exists = prev.some(g => g.id === gigId);
      if (exists) {
        return prev.map(g => g.id === gigId ? { ...g, featured: true } : g);
      } else {
        return [
          {
            id: gigId,
            freelancerId: profileUser?.id || '',
            freelancerName: profileUser?.name || 'Freelancer',
            freelancerUsername: profileUser ? slugify(profileUser.name) : 'freelancer',
            freelancerAvatar: profileUser?.avatar || '',
            title: 'Professional Service Gig with Secure Escrow',
            category: 'Development & IT',
            description: 'Featured service gig.',
            price: 450,
            deliveryDays: 3,
            rating: 5.0,
            reviewsCount: 84,
            image: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=500&h=300&fit=crop',
            status: 'published' as const,
            featured: true
          },
          ...prev
        ];
      }
    });

    try {
      await fetchWithRetry(`/api/gigs/${gigId}`, {
        method: 'PATCH',
        body: JSON.stringify({ featured: true })
      });
    } catch (e) {
      console.warn('API sync for sample gig feature:', e);
    }

    alert('Gig successfully featured for 7 days! ($10 fee charged to wallet)');
    refresh();
  };

  const handleOptimizeGigWithAI = async () => {
    if (!newGigTitle) {
      alert('Please enter a gig title first.');
      return;
    }
    setNewGigTitle(`Professional ${newGigTitle} with 100% Escrow Guarantee`);
    setNewGigDesc(`✨ Premium Service Offering:\n\n- High-performance delivery tailored to your exact specifications.\n- Thoroughly tested code and enterprise-grade architecture.\n- 14 days of post-launch support and secure Escrow protection.\n\nLet's discuss your project requirements today!`);
  };

  const handlePublishGig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetchWithRetry('/api/gigs', {
        method: 'POST',
        body: JSON.stringify({
          freelancerId: impersonatedUser ? impersonatedUser.id : currentUser.id,
          freelancerName: impersonatedUser ? impersonatedUser.name : currentUser.name,
          freelancerAvatar: impersonatedUser ? impersonatedUser.avatar : currentUser.avatar,
          freelancerLevel: 'Level 1 ★',
          title: newGigTitle,
          category: newGigCat,
          description: newGigDesc,
          price: Number(newGigPrice),
          deliveryDays: Number(newGigDays),
          image: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&h=500&fit=crop',
          status: 'published',
          featured: false,
          extras: newGigExtras
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to publish gig.');
        return;
      }
      alert('Gig published successfully!');
      navigate('/gigs');
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Error publishing gig');
    }
  };

  const handlePostProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      setIsLoginModalOpen(true);
      return;
    }
    try {
      const token = getAuthToken();
      const res = await fetchWithRetry('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          buyerId: impersonatedUser ? impersonatedUser.id : currentUser.id,
          buyerName: impersonatedUser ? impersonatedUser.name : currentUser.name,
          buyerAvatar: impersonatedUser ? impersonatedUser.avatar : currentUser.avatar,
          title: newProjTitle,
          category: newProjCat,
          description: newProjDesc,
          budgetMin: Number(newProjMin),
          budgetMax: Number(newProjMax),
          deadlineDays: 14,
          featured: false
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to post project.');
        return;
      }
      alert('Project posted successfully!');
      navigate('/projects');
      refresh();
    } catch (err: any) {
      alert(err?.message || 'Error posting project');
    }
  };

  // Project proposal & detail route check: /projects/:id OR /project/:slug OR /freelance-jobs/...
  const isProjectDetail = (
    (cleanPath.startsWith('/projects/') && cleanPath.length > 10) ||
    (cleanPath.startsWith('/project/') && cleanPath.length > 9) ||
    (cleanPath.startsWith('/freelance-jobs/') && cleanPath.length > 16)
  ) && !cleanPath.endsWith('/projects') && !cleanPath.endsWith('/freelance-jobs');

  const projIdParam = isProjectDetail ? cleanPath.split('/').pop() : null;

  const currentProject = isProjectDetail
    ? (projects.find(p => {
        if (!projIdParam) return false;
        const lower = projIdParam.toLowerCase();
        const pId = p.id.toLowerCase();
        const pSlug = (p.slug || slugify(p.title)).toLowerCase();
        return pId === lower || 
               pSlug === lower || 
               lower.includes(pId) || 
               lower.endsWith(pId) || 
               lower.includes(pSlug) || 
               pSlug.includes(lower);
      }) || (initialData?.project) || projects[0])
    : undefined;

  // Filtered Gigs computation
  const filteredGigs = gigs.filter(g => {
    const matchesCat = (() => {
      if (currentCategory === 'All') return true;

      const targetLower = currentCategory.toLowerCase();
      const targetNorm = targetLower.replace(/[^\w]/g, '');
      const slugNorm = (categorySlug || '').toLowerCase().replace(/[^\w]/g, '');

      const catLower = (g.category || '').toLowerCase();
      const catNorm = catLower.replace(/[^\w]/g, '');

      const subLower = (g.subcategory || '').toLowerCase();
      const subNorm = subLower.replace(/[^\w]/g, '');

      // Direct match on category or subcategory
      if (catLower === targetLower || subLower === targetLower) return true;
      if (targetNorm.length > 2 && (catNorm === targetNorm || subNorm === targetNorm)) return true;
      if (slugNorm.length > 2 && (catNorm.includes(slugNorm) || subNorm.includes(slugNorm) || slugNorm.includes(catNorm) || slugNorm.includes(subNorm))) return true;

      // Parent category match (if currentCategory is a parent category, match any gig whose subcategory belongs to it)
      const parentCat = PPH_CATEGORIES.find(c => c.name.toLowerCase() === targetLower || c.slug === categorySlug);
      if (parentCat) {
        if (catLower === parentCat.name.toLowerCase()) return true;
        const isSubInParent = parentCat.subcategories.some(s => s.name.toLowerCase() === subLower || subLower.includes(s.name.toLowerCase()));
        if (isSubInParent) return true;
      }

      // Aliases match
      if ((targetLower.includes('technology') || targetLower.includes('development') || targetLower.includes('programming')) &&
          (catLower.includes('technology') || catLower.includes('development') || catLower.includes('programming'))) return true;

      if ((targetLower.includes('ai') || targetLower.includes('data')) &&
          (catLower.includes('ai') || catLower.includes('data'))) return true;

      if ((targetLower.includes('design') || targetLower.includes('creative')) &&
          (catLower.includes('design') || catLower.includes('creative'))) return true;

      // Search match in title or description
      if (g.title?.toLowerCase().includes(targetLower) || g.description?.toLowerCase().includes(targetLower)) return true;
      if (targetNorm.length > 2 && (
        g.title?.toLowerCase().replace(/[^\w]/g, '').includes(targetNorm) ||
        g.description?.toLowerCase().replace(/[^\w]/g, '').includes(targetNorm)
      )) return true;

      return false;
    })();
    const matchesSearch = g.title.toLowerCase().includes(searchQuery.toLowerCase()) || g.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesServiceOpt = serviceOptionFilter === 'All' || g.category === serviceOptionFilter;
    const matchesSellerLevel = sellerLevelFilter === 'All' || (g.freelancerLevel && g.freelancerLevel.includes(sellerLevelFilter));
    const matchesBudget = budgetFilter === 'All' 
      ? true 
      : budgetFilter === 'under_500' ? g.price <= 500
      : budgetFilter === '500_1000' ? g.price > 500 && g.price <= 1000
      : g.price > 1000;
    const matchesDelivery = deliveryTimeFilter === null || g.deliveryDays <= deliveryTimeFilter;
    const author = usersList.find(u => u.id === g.freelancerId);
    const isCurrentAuthor = currentUser && (currentUser.id === g.freelancerId || currentUser.name === g.freelancerName);
    const availableStatus = isCurrentAuthor ? currentUser.isAvailableNow : (author ? author.isAvailableNow : true);
    const matchesOnline = !onlineNowOnly || availableStatus !== false;

    return matchesCat && matchesSearch && matchesServiceOpt && matchesSellerLevel && matchesBudget && matchesDelivery && matchesOnline;
  });

  // Dedicated Admin Panel Route
  if (isAdmin) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm font-semibold">Loading Admin Console...</div>}>
        <AdminPage
          currentUser={currentUser}
          impersonatedUser={impersonatedUser}
          updateCurrentUser={updateCurrentUser}
          setImpersonatedUser={setImpersonatedUser}
          usersList={usersList}
          setUsersList={setUsersList}
          projects={projects}
          gigs={gigs}
          orders={orders}
          proposals={proposals}
          platformFee={platformFee}
          clientServiceFee={clientServiceFee}
          smallOrderFeeThreshold={smallOrderFeeThreshold}
          smallOrderFeeAmount={smallOrderFeeAmount}
          escrowProtectionDays={escrowProtectionDays}
          navigate={navigate}
          refresh={refresh}
          getDeviceId={getDeviceId}
        />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden flex flex-col bg-slate-50 text-fiverr-dark font-sans selection:bg-emerald-500 selection:text-white">
      <ImpersonationBanner impersonatedUser={impersonatedUser} onStop={handleStopImpersonation} />

      <Header
        navigate={navigate}
        currentUser={impersonatedUser || currentUser}
        orders={currentUser || impersonatedUser ? hydratedWorkstreamItems : []}
        likedGigIds={likedGigIds}
        isGigsList={isGigsList}
        isGigDetail={isGigDetail}
        isProjectsList={isProjectsList}
        isProjectDetail={isProjectDetail}
        isCategoryRoute={isCategoryRoute}
        loadUserSession={loadUserSession}
        updateCurrentUser={updateCurrentUser}
        setImpersonatedUser={setImpersonatedUser}
        setSelectedOrder={setSelectedOrder}
        setPath={setPath}
        fetchMessages={fetchMessages}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onOpenSignup={() => setIsSignupModalOpen(true)}
        onOpenSwitchUser={() => setIsUserSwitchModalOpen(true)}
      />

      {/* PeoplePerHour Category Navigation Bar */}
      <HeaderCategoriesNav 
        navigate={navigate}
        currentCategory={currentCategory}
      />





      {/* Restricted Account Warning Banner */}
      {currentUser?.status === 'restricted' && !impersonatedUser && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center gap-3 animate-in slide-in-from-top duration-500">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <p className="text-[11px] font-bold text-amber-900">
            Your account privileges are currently restricted. <button onClick={() => { setSupportSubject('Appeal: Account Restriction'); setIsSupportModalOpen(true); }} className="underline hover:text-amber-700 ml-1 cursor-pointer">Learn more or submit an appeal</button>
          </p>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto px-4 sm:px-6 py-8 overflow-x-hidden">
        
        {/* GLOBAL SUSPENSION GUARD */}
        {currentUser?.status === 'suspended' && !impersonatedUser && (
          <SuspensionScreen 
            user={currentUser} 
            navigate={navigate} 
            onAppeal={() => {
              setSupportSubject(`Appeal Request: Account Suspension (#${currentUser.id})`);
              setSupportMessage(`Hello Support,\n\nI am writing to appeal the suspension of my account. I believe this might be an error or I would like more information on how to rectify the situation.\n\nReason cited: ${currentUser.flagReason || 'Policy Violation'}`);
              setIsSupportModalOpen(true);
            }} 
          />
        )}

        {/* REST OF CONTENT - Only if not suspended */}
        {(!currentUser || currentUser.status !== 'suspended' || impersonatedUser) && (
          <>
        
        {/* VIEW: FREELANCER ACTIVITY (/freelance-activity) */}
        {path === '/freelance-activity' && (
          <div className="max-w-7xl mx-auto space-y-8 font-sans">
            <div>
              <h1 className="text-3xl font-bold text-fiverr-dark tracking-tight">My Freelancer Activity</h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
              {/* Main Content (3 cols) */}
              <div className="lg:col-span-3 space-y-6">
                {/* PROJECTS / OFFERS TOGGLE TABS */}
                <div className="flex rounded-2xl bg-slate-200/70 p-1 w-fit">
                  <button
                    onClick={() => {
                      setFreelanceTab('projects');
                      setFreelanceSubFilter('All');
                    }}
                    className={`px-6 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      freelanceTab === 'projects' ? 'bg-white text-fiverr-dark shadow-sm' : 'text-fiverr-dark hover:text-fiverr-dark'
                    }`}
                  >
                    PROJECTS
                  </button>
                  <button
                    onClick={() => {
                      setFreelanceTab('offers');
                      setFreelanceSubFilter('All');
                    }}
                    className={`px-6 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      freelanceTab === 'offers' ? 'bg-emerald-600 text-white shadow-sm' : 'text-fiverr-dark hover:text-fiverr-dark'
                    }`}
                  >
                    OFFERS
                  </button>
                </div>

                {/* SUB FILTERS */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-2 text-xs font-bold text-fiverr-dark shadow-xs overflow-x-auto">
                  {(freelanceTab === 'projects' ? ['All', 'In Progress', 'Completed', 'Expired'] : ['All', 'Active', 'Paused', 'Pending', 'Declined', 'Featured']).map(sub => (
                    <button
                      key={sub}
                      onClick={() => setFreelanceSubFilter(sub)}
                      className={`px-3.5 py-1.5 rounded-xl transition-colors cursor-pointer ${
                        freelanceSubFilter === sub ? 'bg-slate-900 text-white shadow-xs' : 'hover:bg-slate-100 text-fiverr-dark'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>

                {/* PROJECTS VS OFFERS CONDITIONAL LIST */}
                {freelanceTab === 'projects' ? (
                  <div className="bg-white border border-slate-200 rounded-3xl shadow-xs divide-y divide-slate-100 overflow-hidden">
                    {(() => {
                      const currentUid = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : '');
                      const filteredOrders = orders.filter(ord => {
                        const isMyOrder = Boolean(currentUid && (ord.sellerId === currentUid || ord.buyerId === currentUid));
                        if (!isMyOrder) return false;

                        const isExpired = (new Date(ord.dueDate) < new Date() && ord.status !== 'completed') || ord.status === 'cancelled';
                        if (freelanceSubFilter === 'Active' || freelanceSubFilter === 'In Progress') {
                          return (ord.status === 'in_progress' || ord.status === 'funded_in_escrow' || ord.status === 'revision' || ord.status === 'disputed' || ord.status === 'delivered') && !isExpired;
                        }
                        if (freelanceSubFilter === 'Completed') return ord.status === 'completed';
                        if (freelanceSubFilter === 'Expired') return isExpired;
                        return true;
                      });

                      if (filteredOrders.length === 0) {
                        return (
                          <div className="text-center py-16 text-slate-400 text-xs space-y-2">
                            <p className="font-semibold text-fiverr-dark">No projects found under &ldquo;{freelanceSubFilter}&rdquo;.</p>
                            <p className="text-slate-400">All ongoing client milestones and workstreams will appear here.</p>
                          </div>
                        );
                      }

                      return filteredOrders.map(ord => {
                        const isExpired = (new Date(ord.dueDate) < new Date() && ord.status !== 'completed') || ord.status === 'cancelled';
                        return (
                          <div key={ord.id} className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-slate-50/70 transition-colors">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  isExpired ? 'bg-red-50 text-red-700 border border-red-200' :
                                  ord.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                                }`}>
                                  {isExpired ? 'Expired / Overdue' : (ord.status || 'in_progress').replace(/_/g, ' ')}
                                </span>
                                <span className="text-[11px] text-slate-400 font-mono">Order #{ord.id}</span>
                              </div>
                              <h4 className="text-sm font-bold text-fiverr-dark">{ord.title}</h4>
                              <p className="text-xs text-fiverr-muted">Due Date: {ord.dueDate === '2026-03-30' ? <span className="text-[15px]">{ord.dueDate}</span> : ord.dueDate} · Escrow Amount: <span className="font-bold text-fiverr-dark">${ord.amount}</span></p>
                            </div>

                            <button
                              onClick={() => {
                                navigate('/messages/' + ord.id);
                              }}
                              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs transition-colors whitespace-nowrap cursor-pointer"
                            >
                              Open Workstream
                            </button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-3xl shadow-xs divide-y divide-slate-100 overflow-hidden">
                    {(() => {
                      const currentUid = impersonatedUser ? impersonatedUser.id : (currentUser ? currentUser.id : '');
                      const filteredGigs = gigs.filter(g => {
                        const isMyGig = Boolean(currentUid && (g.freelancerId === currentUid || (currentUser && g.freelancerName?.toLowerCase() === currentUser.name?.toLowerCase())));
                        if (!isMyGig) return false;

                        if (freelanceSubFilter === 'Active') return g.status === 'published' && (!g.moderationStatus || g.moderationStatus === 'approved');
                        if (freelanceSubFilter === 'Paused') return g.status === 'suspended' || g.status === 'paused' || g.status === 'draft';
                        if (freelanceSubFilter === 'Pending') return g.status === 'pending' || g.moderationStatus === 'pending';
                        if (freelanceSubFilter === 'Declined') return g.status === 'declined' || g.moderationStatus === 'rejected' || g.moderationStatus === 'flagged';
                        if (freelanceSubFilter === 'Featured') return !!g.featured;
                        return true;
                      });

                      if (filteredGigs.length === 0) {
                        return (
                          <div className="text-center py-16 text-slate-400 text-xs space-y-2">
                            <p className="font-semibold text-fiverr-dark">No services or offers found under &ldquo;{freelanceSubFilter}&rdquo;.</p>
                            <p className="text-slate-400">Post new services or update statuses to view them in this list.</p>
                          </div>
                        );
                      }

                      return filteredGigs.map(gig => {
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
                                  onClick={(e) => navigate(gUrl, e)}
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
                                    onClick={() => handleFeatureUserGig(gig.id)}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
                                  >
                                    {gig.featured ? '★ FEATURED' : 'FEATURE IT'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveFeatureDropdownGigId(activeFeatureDropdownGigId === gig.id ? null : gig.id);
                                    }}
                                    className="px-2.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer flex items-center justify-center"
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {activeFeatureDropdownGigId === gig.id && (
                                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-2xl shadow-2xl border border-slate-200 py-2 z-50 text-xs font-sans" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      onClick={async () => {
                                        setActiveFeatureDropdownGigId(null);
                                        const newStatus = gig.status === 'published' ? 'suspended' : 'published';
                                        setGigs(prev => prev.map(g => g.id === gig.id ? { ...g, status: newStatus } : g));
                                        try {
                                          await fetch(`/api/gigs/${gig.id}`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ status: newStatus })
                                          });
                                        } catch (e) {
                                          console.warn('Status patch error:', e);
                                        }
                                        try {
                                          await fetch(`/api/admin/gigs/${gig.id}/status`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ status: newStatus })
                                          });
                                        } catch (e) {
                                          // admin fallback
                                        }
                                        setDeleteSuccessToast(`Gig "${gig.title}" status changed to ${newStatus === 'published' ? 'Active' : 'Paused'}.`);
                                        setTimeout(() => setDeleteSuccessToast(null), 3000);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                                    >
                                      {gig.status === 'published' ? 'Pause' : 'Resume'}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setActiveFeatureDropdownGigId(null);
                                        setViewingGig(gig);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                                    >
                                      View Progress
                                    </button>
                                    <button
                                      onClick={() => {
                                        setActiveFeatureDropdownGigId(null);
                                        handleOpenEditGigModal(gig);
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 text-fiverr-dark font-semibold cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => {
                                        setActiveFeatureDropdownGigId(null);
                                        handleDeleteGig(gig.id, gig.title);
                                      }}
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
                      });
                    })()}
                  </div>
                )}
              </div>

              {/* Right Sidebar: MY ACTIVITY SUMMARY */}
              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-3 border-b border-slate-100">
                    My Activity Summary
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between text-fiverr-dark font-medium">
                      <span>Offers I posted</span>
                      <span className="font-bold text-fiverr-dark font-mono">{gigs.filter(g => g.freelancerId === (currentUser?.id || '')).length}</span>
                    </div>
                    <div className="flex items-center justify-between text-fiverr-dark font-medium">
                      <span>Active Offers</span>
                      <span className="font-bold text-emerald-600 font-mono">{gigs.filter(g => g.status === 'published' && g.freelancerId === (currentUser?.id || '')).length}</span>
                    </div>
                    <div className="flex items-center justify-between text-fiverr-dark font-medium">
                      <span>Offers sold</span>
                      <span className="font-bold text-fiverr-dark font-mono">{orders.filter(o => o.sellerId === (currentUser?.id || '') && o.status === 'completed').length}</span>
                    </div>
                    <div className="flex items-center justify-between text-fiverr-dark font-medium pt-3 border-t border-slate-100">
                      <span className="font-bold text-fiverr-dark">Earnings</span>
                      <span className="font-bold text-emerald-600 font-mono text-sm">${(currentUser?.earned || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: FREELANCER TALENT DIRECTORY (/freelancers) */}
        {isFreelancersPage && (
          <FreelancerSearchView
            usersList={usersList}
            gigs={gigs}
            navigate={navigate}
            currentUser={currentUser}
            setIsSignupModalOpen={setIsSignupModalOpen}
            slugify={slugify}
          />
        )}


        {/* VIEW 1: GIGS EXPLORE MARKETPLACE */}
        {isGigsList && (
          <div>
            {/* Hero Banner */}
            <div className="relative rounded-3xl bg-slate-900 text-white p-8 md:p-12 mb-10 overflow-hidden shadow-xl">
              <div className="absolute right-0 top-0 w-1/2 h-full opacity-20 bg-cover bg-center pointer-events-none" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&h=800&fit=crop')` }}></div>
              <div className="relative z-10 max-w-2xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold mb-4 border border-emerald-500/30">
                  <ShieldCheck className="w-4 h-4" /> 100% Escrow Protection Guaranteed
                </div>
                <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-4 text-fiverr-dark text-wrap balance">
                  {currentCategory === 'All' ? 'Hire top freelance talent for fixed-price gigs' : `${currentCategory} Freelance Gigs`}
                </h1>
                <p className="text-fiverr-muted text-sm md:text-base leading-body mb-8">
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
              {['All', ...PPH_CATEGORIES.map(c => c.name)].map(catName => {
                const slug = CATEGORY_SLUGS[catName] || slugify(catName);
                const catUrl = slug === 'all' ? '/' : `/categories/${slug}`;
                const isActive = currentCategory?.toLowerCase() === catName.toLowerCase();
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
                          {gig.title}
                        </h3>
                        <div className="flex items-center gap-2.5 text-xs text-fiverr-muted">
                          <img src={gig.freelancerAvatar} alt={gig.freelancerName} className="w-6 h-6 rounded-full object-cover" />
                          <span className="font-semibold text-slate-800">{gig.freelancerName}</span>
                          <span className="text-slate-300">•</span>
                          <span>Delivery in {gig.deliveryDays} days</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto shrink-0 border-t md:border-t-0 pt-4 md:pt-0 border-slate-100">
                      <div className="text-left md:text-right">
                        <span className="text-xs font-normal uppercase tracking-wider text-fiverr-muted block">Starting at</span>
                        <span className="text-2xl font-bold text-fiverr-dark">${gig.price}</span>
                      </div>
                      <a 
                        href={getGigUrl(gig)}
                        onClick={(e) => { e.stopPropagation(); navigate(getGigUrl(gig), e); }}
                        className="px-6 py-3 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        View Gig
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Active Buyer Projects Section below Gigs on Homepage - LISTICLE VIEW */}
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
                  <span>View All Projects ({projects.filter(p => p.status === 'open' || p.status === 'published').length})</span>
                  <ChevronRight className="w-4 h-4 text-emerald-400" />
                </button>
              </div>

              {/* Listicle View of Projects */}
              <div className="space-y-4">
                {projects.filter(p => p.status === 'open' || p.status === 'published').slice(0, 8).map((project) => {
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
                        <h3 className="font-bold text-base text-fiverr-dark group-hover:text-emerald-600 transition-colors line-clamp-1 leading-snug">
                          <a 
                            href={projectUrl} 
                            onClick={(e) => { e.stopPropagation(); navigate(projectUrl, e); }}
                            className="hover:text-emerald-600 transition-colors"
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
        )}

        {/* VIEW 2: GIG INNER DETAIL PAGE (Fiverr URL Format: /:username/:slug) */}
        {isGigDetail && currentGig && (
          <GigDetailView
            currentGig={currentGig}
            gigs={gigs}
            reviews={appReviews}
            navigate={navigate}
            handleContactSeller={handleContactSeller}
            handleCreateOrder={handleCreateOrder}
            slugify={slugify}
          />
        )}

        {/* VIEW 3: BUYER REQUESTS / PROJECT SEARCH (/projects) */}
        {isProjectsList && (
          <ProjectSearchView
            projects={projects}
            navigate={navigate}
            currentUser={currentUser}
            query={initialData?.query}
          />
        )}

        {/* VIEW 4: PROJECT PROPOSAL & DETAIL PAGE (Clean URL /projects/:id or /freelance-jobs/...) */}
        {isProjectDetail && currentProject && (
          <ProjectDetailView
            project={currentProject}
            currentUser={impersonatedUser || currentUser}
            navigate={navigate}
            onSubmitProposal={(projectId, bidAmount, deliveryDays, coverLetter) => {
              handleSubmitProposalDirect(projectId, bidAmount, deliveryDays, coverLetter);
            }}
            allProjects={projects}
            proposals={proposals}
            orders={orders}
            onRefresh={refresh}
            onContactBuyer={(buyerId, buyerName, projectTitle, projectId) => {
              handleContactSeller(buyerId, buyerName, projectTitle, undefined, projectId);
            }}
          />
        )}

        {isBuyerActivity && (
          <BuyerActivityView
            projects={projects}
            orders={orders}
            offers={offers}
            currentUser={impersonatedUser || currentUser}
            navigate={navigate}
          />
        )}

        {/* VIEW: CUSTOMER SUPPORT CENTER (/support) */}
        {isSupport && (
          <div className="max-w-3xl mx-auto space-y-8 font-sans py-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-8 md:p-12 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-6 border-b border-slate-100">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <HelpCircle className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-fiverr-dark">WorkPerHour Support Center</h1>
                  <p className="text-xs text-fiverr-muted">Submit an inquiry, appeal account restrictions, or request assistance from our support team.</p>
                </div>
              </div>

              <form onSubmit={handleCreateSupportTicket} className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Inquiry Subject / Topic</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Account Verification / Escrow Payout Question" 
                    value={supportSubject}
                    onChange={(e) => setSupportSubject(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Detailed Message / Explanation</label>
                  <textarea 
                    rows={6}
                    placeholder="Please provide all relevant details so our support team can assist you promptly..."
                    value={supportMessage}
                    onChange={(e) => setSupportMessage(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-4">
                  <button 
                    type="button" 
                    onClick={(e) => navigate('/', e)}
                    className="px-5 py-2.5 text-xs font-bold text-fiverr-dark bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    Back to Marketplace
                  </button>
                  <button 
                    type="submit" 
                    className="px-6 py-3 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    Submit Support Ticket
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* VIEW: ACCOUNT & PROFILE SETTINGS WEBPAGE (/settings) */}
        {isSettings && (
          <Suspense fallback={<div className="py-16 text-center text-slate-400 text-sm">Loading Settings...</div>}>
            <SettingsPage 
              currentUser={currentUser}
              updateCurrentUser={updateCurrentUser}
              navigate={navigate}
            />
          </Suspense>
        )}

        {/* VIEW: LOGIN WEBPAGE (/login) */}
        {isLoginRoute && (
          <div className="max-w-md mx-auto space-y-6 font-sans py-8">
            {currentUser ? (
              <div className="bg-white border border-emerald-200 rounded-3xl p-8 shadow-sm space-y-5 text-center">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">You are already signed in!</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Currently authenticated as <strong>{currentUser.name}</strong> ({currentUser.email}).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  <button 
                    onClick={(e) => navigate('/', e)} 
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
                  >
                    Go to Marketplace
                  </button>
                  <button 
                    onClick={() => handleLogout()} 
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Log Out / Switch Account
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
                <div className="text-center space-y-1">
                  <div className="w-12 h-12 rounded-2xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold text-xl mx-auto shadow-md mb-3">
                    W
                  </div>
                  <h1 className="text-2xl font-bold text-fiverr-dark">Login to WorkPerHour</h1>
                  <p className="text-xs text-fiverr-muted">Enter your email credentials or test authentication below.</p>
                </div>

                {loginError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 space-y-1">
                    <div className="flex items-center gap-2 font-bold text-red-900">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{loginError}</span>
                    </div>
                  </div>
                )}

                {loginRequiresCode ? (
                  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleLoginSubmit(e); }}>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800 space-y-1">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900">
                        <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>Device Verification Code Required</span>
                      </div>
                      <p>{loginVerificationMessage || `Enter the 6-digit verification code sent to ${loginEmail}.`}</p>
                    </div>

                    {mockEmailCodeDisplay && (
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-900">
                            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Demo 2FA OTP</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setLoginCode(mockEmailCodeDisplay)}
                            className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                          >
                            Auto-fill
                          </button>
                        </div>
                        <div className="flex items-center justify-between bg-white px-3 py-1.5 rounded-xl border border-emerald-200">
                          <span className="font-mono font-bold text-base tracking-widest text-emerald-700">{mockEmailCodeDisplay}</span>
                          <button
                            type="button"
                            onClick={() => setLoginCode(mockEmailCodeDisplay)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-[10px] transition cursor-pointer"
                          >
                            Use Code
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="text-xs font-bold text-fiverr-dark uppercase block mb-1">Enter 6-Digit Email Code</label>
                      <input 
                        type="text" 
                        maxLength={6} 
                        placeholder="123456" 
                        value={loginCode} 
                        onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, ''))} 
                        required 
                        autoFocus
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center text-lg font-mono font-bold tracking-widest bg-white focus:outline-emerald-500" 
                      />
                    </div>

                    <button 
                      type="submit" 
                      disabled={isSubmittingLogin}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition cursor-pointer text-xs flex items-center justify-center gap-2 shadow-xs"
                    >
                      {isSubmittingLogin && <RefreshCw className="w-4 h-4 animate-spin" />}
                      <span>{isSubmittingLogin ? 'Verifying...' : 'Verify Code & Complete Login'}</span>
                    </button>

                    <div className="flex items-center justify-between text-xs pt-1">
                      <button 
                        type="button" 
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/auth/resend-email-code', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ email: loginEmail })
                            });
                            const data = await res.json();
                            if (res.ok && data.mockEmailCode) {
                              setMockEmailCodeDisplay(data.mockEmailCode);
                              setLoginCode(data.mockEmailCode);
                            }
                          } catch (e) {
                            console.warn(e);
                          }
                        }} 
                        className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                      >
                        Resend Code
                      </button>
                      <button 
                        type="button" 
                        onClick={() => { setLoginRequiresCode(false); setLoginCode(''); }} 
                        className="text-fiverr-muted hover:text-slate-800 cursor-pointer"
                      >
                        Back to Password
                      </button>
                    </div>
                  </form>
                ) : (
                  <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleLoginSubmit(e); }}>
                    <div>
                      <label className="block text-xs font-bold text-fiverr-dark uppercase mb-1">Email Address</label>
                      <input type="email" placeholder="e.g. elena@example.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-fiverr-dark uppercase mb-1">Password</label>
                      <input type="password" placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-slate-900" />
                    </div>
                    <button 
                      type="submit" 
                      disabled={isSubmittingLogin}
                      className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 disabled:opacity-60 transition cursor-pointer text-xs flex items-center justify-center gap-2"
                    >
                      {isSubmittingLogin && <RefreshCw className="w-4 h-4 animate-spin" />}
                      <span>{isSubmittingLogin ? 'Signing In...' : 'Sign In'}</span>
                    </button>
                    <div className="flex items-center justify-between text-xs pt-2">
                      <button type="button" onClick={(e) => navigate('/forgot-password', e)} className="text-emerald-700 font-semibold hover:underline cursor-pointer">Forgot Password?</button>
                      <button type="button" onClick={(e) => navigate('/signup', e)} className="text-fiverr-muted hover:text-slate-900 cursor-pointer">Create an account</button>
                    </div>
                  </form>
                )}

                {(import.meta as any).env?.DEV && usersList.length > 0 && !loginRequiresCode && (
                  <div className="pt-4 border-t border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2 text-center">Instant Demo Account Login</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {usersList.filter(u => !['admin', 'super_admin', 'support'].includes(u.role || '')).slice(0, 4).map(u => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={async () => {
                            const session = await requestDemoSession(u.id);
                            if (!session) {
                              setLoginError('Demo login is not available on this server.');
                              return;
                            }
                            setAuthToken(session.token);
                            updateCurrentUser(session.user);
                            setImpersonatedUser(null);
                            refresh();
                            navigate('/');
                          }}
                          className="p-2 border border-slate-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/50 text-left transition cursor-pointer flex items-center gap-2 group"
                        >
                          <img src={u.avatar} alt={u.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                          <div className="min-w-0">
                            <div className="font-bold text-fiverr-dark truncate group-hover:text-emerald-700">{u.name}</div>
                            <div className="text-[10px] text-slate-400 capitalize">{(u.role || 'freelancer').replace('_', ' ')}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* VIEW: SIGNUP WEBPAGE (/signup) */}
        {isSignupRoute && (
          <div className="max-w-md mx-auto space-y-6 font-sans py-8">
            {currentUser && (currentUser.emailVerified || currentUser.verified) ? (
              <div className="bg-white border border-emerald-200 rounded-3xl p-8 shadow-sm space-y-5 text-center">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">You are already signed in!</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Currently authenticated as <strong>{currentUser.name}</strong> ({currentUser.email}).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  <button 
                    onClick={(e) => navigate('/', e)} 
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
                  >
                    Go to Marketplace
                  </button>
                  <button 
                    onClick={() => handleLogout()} 
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Log Out / Switch Account
                  </button>
                </div>
              </div>
            ) : currentUser && (!currentUser.emailVerified && !currentUser.verified) ? (
              <div className="bg-white border border-emerald-200 rounded-3xl p-8 shadow-sm space-y-6">
                <div className="text-center space-y-1">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <h1 className="text-2xl font-bold text-fiverr-dark">Account Created Successfully!</h1>
                  <p className="text-xs text-fiverr-muted">
                    Welcome, <strong>{currentUser.name}</strong>! Please verify your email to activate all features.
                  </p>
                </div>

                {mockEmailCodeDisplay && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-900">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Sandbox Verification Code</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEmailCodeInput(mockEmailCodeDisplay)}
                        className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                      >
                        Auto-fill
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-white px-3.5 py-2 rounded-xl border border-emerald-200">
                      <span className="font-mono font-bold text-lg tracking-widest text-emerald-700">{mockEmailCodeDisplay}</span>
                      <button
                        type="button"
                        onClick={() => setEmailCodeInput(mockEmailCodeDisplay)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                      >
                        Use Code
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleVerifyEmailSubmit} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-slate-700 font-bold uppercase mb-1">Enter 6-Digit Email Code</label>
                    <input 
                      type="text" 
                      maxLength={6} 
                      placeholder="123456" 
                      value={emailCodeInput} 
                      onChange={(e) => setEmailCodeInput(e.target.value.replace(/\D/g, ''))} 
                      required 
                      className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center font-mono font-bold text-xl tracking-widest focus:ring-2 focus:ring-emerald-500" 
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition cursor-pointer shadow-xs text-sm"
                  >
                    Verify Email & Continue
                  </button>

                  <div className="flex items-center justify-between text-xs pt-2">
                    <button 
                      type="button" 
                      onClick={handleResendEmailCode}
                      className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                    >
                      Resend Code
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setIsEmailModalOpen(true)}
                      className="text-slate-600 hover:text-slate-900 cursor-pointer underline"
                    >
                      View In-App Email Inbox
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
                <div className="text-center space-y-1">
                  <h1 className="text-2xl font-bold text-fiverr-dark">Create WorkPerHour Account</h1>
                  <p className="text-xs text-fiverr-muted">Join the secure escrow marketplace for freelancers and clients.</p>
                </div>

                {signupError && (
                  <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-red-900">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{signupError}</span>
                    </div>
                    {signupError.toLowerCase().includes('already exists') && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            setLoginEmail(signupEmail);
                            navigate('/login', e);
                          }}
                          className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition cursor-pointer text-xs flex items-center gap-1.5"
                        >
                          <span>Log In to Existing Account</span>
                          <span>→</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleSignupSubmit} className="space-y-4 text-xs">
                  <div>
                    <label className="block text-fiverr-dark font-bold uppercase mb-1">Full Name</label>
                    <input 
                      type="text" 
                      placeholder="e.g. John Doe" 
                      value={signupName} 
                      onChange={(e) => setSignupName(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden" 
                    />
                  </div>
                  <div>
                    <label className="block text-fiverr-dark font-bold uppercase mb-1">Email Address</label>
                    <input 
                      type="email" 
                      placeholder="you@example.com" 
                      value={signupEmail} 
                      onChange={(e) => setSignupEmail(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden" 
                    />
                  </div>
                  <div>
                    <label className="block text-fiverr-dark font-bold uppercase mb-1">Mobile Phone Number <span className="text-slate-400 font-normal lowercase">(optional)</span></label>
                    <input 
                      type="tel" 
                      placeholder="+1 (555) 000-0000" 
                      value={signupMobile} 
                      onChange={(e) => setSignupMobile(e.target.value)} 
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden" 
                    />
                  </div>
                  <div>
                    <label className="block text-fiverr-dark font-bold uppercase mb-1">Password</label>
                    <input 
                      type="password" 
                      placeholder="6 to 72 characters" 
                      minLength={6}
                      maxLength={72}
                      value={signupPassword} 
                      onChange={(e) => setSignupPassword(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden" 
                    />
                  </div>
                  <div>
                    <label className="block text-fiverr-dark font-bold uppercase mb-1">Confirm Password</label>
                    <input 
                      type="password" 
                      placeholder="Re-enter password" 
                      value={signupConfirmPassword} 
                      onChange={(e) => setSignupConfirmPassword(e.target.value)} 
                      required 
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden" 
                    />
                  </div>

                  <button 
                    type="submit" 
                    disabled={isSubmittingSignup}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-xs"
                  >
                    {isSubmittingSignup && <RefreshCw className="w-4 h-4 animate-spin" />}
                    <span>{isSubmittingSignup ? 'Creating Account...' : 'Register Account'}</span>
                  </button>

                  <div className="text-center pt-2">
                    <button 
                      type="button" 
                      onClick={(e) => {
                        setLoginEmail(signupEmail);
                        navigate('/login', e);
                      }} 
                      className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                    >
                      Already have an account? Login
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* VIEW: FORGOT PASSWORD WEBPAGE (/forgot-password) */}
        {isForgotPasswordRoute && (
          <div className="max-w-md mx-auto space-y-6 font-sans py-8">
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
              <div className="text-center space-y-1">
                <h1 className="text-2xl font-bold text-fiverr-dark">Account Recovery</h1>
                <p className="text-xs text-fiverr-muted">Reset your account password securely.</p>
              </div>

              {forgotStep === 'request' && (
                <form onSubmit={handleForgotRequest} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-fiverr-dark uppercase mb-1">Email or Mobile Number</label>
                    <input type="text" placeholder="e.g. elena@example.com" value={forgotQuery} onChange={(e) => setForgotQuery(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl" />
                  </div>
                  <button type="submit" className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition cursor-pointer">Send Recovery Code</button>
                </form>
              )}

              {forgotStep === 'verify' && (
                <form onSubmit={handleForgotVerify} className="space-y-4 text-xs">
                  {mockForgotCodeDisplay && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 flex items-center justify-between">
                      <span>Test / Demo OTP:</span>
                      <span className="font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200">{mockForgotCodeDisplay}</span>
                    </div>
                  )}
                  <div>
                    <label className="block font-bold text-fiverr-dark uppercase mb-1">6-Digit Recovery Code</label>
                    <input type="text" placeholder="123456" maxLength={6} value={forgotCode} onChange={(e) => setForgotCode(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-center font-mono font-bold text-lg" />
                  </div>
                  <button type="submit" className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition cursor-pointer">Verify Code</button>
                </form>
              )}

              {forgotStep === 'reset' && (
                <form onSubmit={handleForgotReset} className="space-y-4 text-xs">
                  <div>
                    <label className="block font-bold text-fiverr-dark uppercase mb-1">New Password</label>
                    <input type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl" />
                  </div>
                  <div>
                    <label className="block font-bold text-fiverr-dark uppercase mb-1">Confirm New Password</label>
                    <input type="password" placeholder="Confirm new password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} required className="w-full px-4 py-2.5 border border-slate-200 rounded-xl" />
                  </div>
                  <button type="submit" className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition cursor-pointer">Reset Password & Login</button>
                </form>
              )}

              <div className="text-center pt-2">
                <button type="button" onClick={(e) => navigate('/login', e)} className="text-xs text-fiverr-muted hover:text-slate-900 cursor-pointer">Back to Login</button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: VERIFY CODE WEBPAGE (/verify) */}
        {isVerifyRoute && (
          <div className="max-w-md mx-auto space-y-6 font-sans py-8">
            {currentUser && (currentUser.emailVerified || currentUser.verified) ? (
              <div className="bg-white border border-emerald-200 rounded-3xl p-8 shadow-sm space-y-5 text-center">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">Your Account is Verified!</h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Authenticated as <strong>{currentUser.name}</strong> ({currentUser.email}).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  <button 
                    onClick={(e) => navigate('/', e)} 
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
                  >
                    Go to Marketplace
                  </button>
                  <button 
                    onClick={(e) => navigate('/orders', e)} 
                    className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    View My Orders
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
                <div className="text-center space-y-1">
                  <h1 className="text-2xl font-bold text-fiverr-dark">Verify Your Account</h1>
                  <p className="text-xs text-fiverr-muted">
                    {verificationMode === 'email' 
                      ? (verifyEmail ? `Enter the 6-digit code generated for ${verifyEmail}` : 'Enter your 6-digit email OTP below.')
                      : (verifyMobile ? `Enter the 6-digit SMS OTP for ${verifyMobile}` : 'Enter your 6-digit SMS OTP below.')}
                  </p>
                </div>

                {/* Tab Selector */}
                <div className="flex bg-slate-100 p-1 rounded-2xl">
                  <button 
                    onClick={() => setVerificationMode('email')} 
                    className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition cursor-pointer ${verificationMode === 'email' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    Email Verification
                  </button>
                  <button 
                    onClick={() => setVerificationMode('sms')} 
                    className={`flex-1 py-2 text-center text-xs font-bold rounded-xl transition cursor-pointer ${verificationMode === 'sms' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    SMS Verification
                  </button>
                </div>

                {/* Sandbox / Demo OTP Banner */}
                {(verificationMode === 'email' ? mockEmailCodeDisplay : mockSmsCodeDisplay) ? (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-900">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Sandbox / Demo Verification Code</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const code = verificationMode === 'email' ? mockEmailCodeDisplay : mockSmsCodeDisplay;
                          if (verificationMode === 'email') setEmailCodeInput(code);
                          else setSmsCodeInput(code);
                        }}
                        className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                      >
                        Auto-fill
                      </button>
                    </div>
                    <div className="flex items-center justify-between bg-white px-3.5 py-2 rounded-xl border border-emerald-200">
                      <span className="font-mono font-bold text-xl tracking-widest text-emerald-700">
                        {verificationMode === 'email' ? mockEmailCodeDisplay : mockSmsCodeDisplay}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const code = verificationMode === 'email' ? mockEmailCodeDisplay : mockSmsCodeDisplay;
                          if (verificationMode === 'email') setEmailCodeInput(code);
                          else setSmsCodeInput(code);
                        }}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                      >
                        Use Code
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs flex items-center justify-between text-slate-600">
                    <span>Need your verification code?</span>
                    <button 
                      type="button"
                      onClick={verificationMode === 'email' ? handleResendEmailCode : handleResendSmsCode}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition cursor-pointer"
                    >
                      Generate Code
                    </button>
                  </div>
                )}

                {verificationMode === 'email' ? (
                  <form onSubmit={handleVerifyEmailSubmit} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-bold text-fiverr-dark uppercase mb-1">Enter 6-Digit Email Code</label>
                      <input 
                        type="text" 
                        maxLength={6} 
                        placeholder="123456" 
                        value={emailCodeInput} 
                        onChange={(e) => setEmailCodeInput(e.target.value.replace(/\D/g, ''))} 
                        required 
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center font-mono font-bold text-xl tracking-widest focus:ring-2 focus:ring-emerald-500" 
                      />
                    </div>
                    <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition cursor-pointer text-sm shadow-xs">
                      Verify Email Code
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleVerifySmsSubmit} className="space-y-4 text-xs">
                    <div>
                      <label className="block font-bold text-fiverr-dark uppercase mb-1">Enter 6-Digit SMS OTP</label>
                      <input 
                        type="text" 
                        maxLength={6} 
                        placeholder="123456" 
                        value={smsCodeInput} 
                        onChange={(e) => setSmsCodeInput(e.target.value.replace(/\D/g, ''))} 
                        required 
                        className="w-full px-4 py-3 border border-slate-200 rounded-xl text-center font-mono font-bold text-xl tracking-widest focus:ring-2 focus:ring-emerald-500" 
                      />
                    </div>
                    <button type="submit" className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition cursor-pointer text-sm shadow-xs">
                      Verify SMS Code
                    </button>
                  </form>
                )}

                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                  <button 
                    type="button" 
                    onClick={verificationMode === 'email' ? handleResendEmailCode : handleResendSmsCode}
                    className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                  >
                    Resend Code
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setIsEmailModalOpen(true)}
                    className="text-slate-600 hover:text-slate-900 cursor-pointer underline font-medium"
                  >
                    Open In-App Email Inbox
                  </button>
                  <button 
                    type="button" 
                    onClick={(e) => navigate('/login', e)}
                    className="text-fiverr-muted hover:text-slate-900 cursor-pointer"
                  >
                    Back to Login
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW: WISHLIST WEBPAGE (/wishlist) */}
        {isWishlistRoute && (
          <div className="max-w-6xl mx-auto space-y-8 font-sans py-6">
            <div className="flex items-center justify-between pb-6 border-b border-slate-200">
              <div>
                <h1 className="text-2xl font-bold text-fiverr-dark flex items-center gap-2">
                  <Heart className="w-6 h-6 text-red-500 fill-red-500" />
                  <span>Your Saved Gigs ({likedGigIds.length})</span>
                </h1>
                <p className="text-xs text-fiverr-muted mt-1">Gigs and services you have saved to your personal wishlist.</p>
              </div>
            </div>

            {likedGigIds.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-3xl p-12 text-center space-y-4 shadow-sm">
                <Heart className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-fiverr-dark">No saved gigs yet</h3>
                <p className="text-xs text-fiverr-muted max-w-sm mx-auto">Click the heart icon on any gig card to save services to your wishlist for quick access later.</p>
                <button onClick={(e) => navigate('/gigs', e)} className="px-6 py-2.5 bg-slate-900 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer">
                  Explore Gigs
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {gigs.filter(g => likedGigIds.includes(g.id)).map(gig => (
                  <div key={gig.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-xl transition-all flex flex-col justify-between">
                    <img src={gig.image} alt={gig.title} className="w-full h-48 object-cover" />
                    <div className="p-5 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider bg-emerald-50 px-2 py-0.5 rounded">{gig.category}</span>
                        <h4 className="font-bold text-sm text-slate-900 text-fiverr-dark line-clamp-2">{gig.title}</h4>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                        <span className="font-bold text-fiverr-dark">${gig.price}</span>
                        <button onClick={(e) => navigate(getGigUrl(gig), e)} className="px-3 py-1.5 bg-slate-900 text-white font-bold text-xs rounded-lg cursor-pointer">View Gig</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: NOTIFICATIONS WEBPAGE (/notifications) */}
        {isNotificationsRoute && (
          <div className="max-w-4xl mx-auto space-y-8 font-sans py-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-6 border-b border-slate-100">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <Bell className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-fiverr-dark">Notifications & Email Inbox</h1>
                  <p className="text-xs text-fiverr-muted">System alerts, automated email dispatches, and workstream updates.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1">
                  <span className="font-bold text-fiverr-dark block">System Notification Preferences</span>
                  <p className="text-fiverr-muted">Email alerts for escrow deposits, workstream submissions, and milestone approvals are enabled for your account.</p>
                </div>

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="p-4 bg-white flex items-start gap-4">
                    <Mail className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-fiverr-dark">Escrow Deposit Confirmed</span>
                        <span className="text-[10px] text-slate-400 font-mono">Today</span>
                      </div>
                      <p className="text-fiverr-muted">Milestone funds have been securely locked in the WorkPerHour Escrow Vault.</p>
                    </div>
                  </div>
                  <div className="p-4 bg-white flex items-start gap-4">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-fiverr-dark">Workstream Active</span>
                        <span className="text-[10px] text-slate-400 font-mono">Yesterday</span>
                      </div>
                      <p className="text-fiverr-muted">Your real-time collaboration session is active with your project partner.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: SWITCH USER WEBPAGE (/switch-user) */}
        {isSwitchUserRoute && (
          <div className="max-w-4xl mx-auto space-y-8 font-sans py-6">
            <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-sm space-y-6">
              <div className="flex items-center gap-3 pb-6 border-b border-slate-100">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-fiverr-dark">Switch Demo Account</h1>
                  <p className="text-xs text-fiverr-muted">Instantly switch session role to test client, freelancer, or administrator perspectives.</p>
                </div>
              </div>

              {usersList.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-slate-500">
                  <p className="text-sm font-bold text-slate-700 mb-1">No user accounts exist yet</p>
                  <p className="text-xs text-slate-400">Create a new user account through <a href="/signup" onClick={(e) => navigate('/signup', e)} className="text-emerald-600 underline font-semibold">Signup</a> or <a href="/admin" onClick={(e) => navigate('/admin', e)} className="text-emerald-600 underline font-semibold">Admin Portal</a>.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {usersList.map(u => (
                    <div key={u.id} className="p-5 border border-slate-200 rounded-2xl hover:border-emerald-500 hover:shadow-md transition-all flex items-center justify-between gap-4 bg-white">
                      <div className="flex items-center gap-3 min-w-0">
                        <img src={u.avatar} alt={u.name} className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-fiverr-dark text-sm block truncate">{u.name}</span>
                          <span className="text-[10px] text-slate-400 uppercase font-mono">{u.role} · ${u.hourlyRate}/hr</span>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/auth/demo-session', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ userId: u.id })
                            });
                            const data = await res.json();
                            if (res.ok && data.token) {
                              setAuthToken(data.token);
                              updateCurrentUser(data.user);
                              setImpersonatedUser(null);
                              alert(`Switched account to ${u.name} (${u.role})`);
                              navigate('/orders');
                            }
                          } catch (e) {
                            console.warn(e);
                          }
                        }}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer shrink-0"
                      >
                        Switch to Account
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VIEW 5: MY ORDERS & ESCROW (/orders) */}
        {isOrders && (
          (!currentUser && !impersonatedUser) ? (
            <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-4 shadow-sm">
              <Shield className="w-12 h-12 text-slate-400 mx-auto" />
              <h2 className="text-xl font-bold text-fiverr-dark">Sign in to Access Your Orders</h2>
              <p className="text-xs text-fiverr-muted">Track project milestones, real-time workstream messages, and escrow releases.</p>
              <button 
                onClick={() => setIsLoginModalOpen(true)} 
                className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition cursor-pointer"
              >
                Sign In to WorkPerHour
              </button>
            </div>
          ) : (
          <div>
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-fiverr-dark">Active Orders & Escrow Vault</h1>
              <p className="text-sm text-fiverr-muted">Track milestones, secure escrow funds, and deliver completed work.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="space-y-3">
                {orders.map(ord => (
                  <div 
                    key={ord.id}
                    onClick={() => { setSelectedOrder(ord); fetchMessages(ord.id); }}
                    className={`p-5 rounded-2xl border transition-all cursor-pointer ${selectedOrder?.id === ord.id ? 'border-slate-900 bg-slate-900 text-white shadow-lg' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${selectedOrder?.id === ord.id ? 'bg-emerald-400 text-fiverr-dark' : 'bg-emerald-50 text-emerald-700'}`}>
                        {(ord.status || 'in_progress').replace(/_/g, ' ')}
                      </span>
                      <span className={`text-sm font-bold ${selectedOrder?.id === ord.id ? 'text-emerald-400' : 'text-fiverr-dark'}`}>${ord.amount}</span>
                    </div>
                    <h4 className="text-sm font-bold mb-3 line-clamp-1">{ord.title}</h4>
                    <div className={`flex items-center justify-between text-xs ${selectedOrder?.id === ord.id ? 'text-slate-300' : 'text-fiverr-muted'}`}>
                      <span>Due: {ord.dueDate === '2026-03-30' ? <span className="text-[15px]">{ord.dueDate}</span> : ord.dueDate}</span>
                      <span>Order #{ord.id}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                {selectedOrder ? (
                  <div>
                    <div className="flex items-center justify-between pb-6 border-b border-slate-100 mb-6">
                      <div>
                        <span className="text-xs font-semibold text-emerald-600 block mb-1">
                          {selectedOrder.status === 'completed' ? 'Completed · Escrow Released' : selectedOrder.status === 'cancelled' ? 'Cancelled · Escrow Refunded' : 'Escrow Secured'}
                        </span>
                        <h2 className="text-xl font-bold text-fiverr-dark">{selectedOrder.title}</h2>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-400 block font-medium">
                          {selectedOrder.status === 'completed' ? 'Escrow Vault ($0) · Paid' : 'Total Amount'}
                        </span>
                        <span className="text-xl font-bold text-fiverr-dark">${selectedOrder.amount}</span>
                      </div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-4 mb-6 flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-emerald-900">
                        <span className="font-bold block mb-1">
                          {selectedOrder.status === 'completed'
                            ? 'Escrow Funds Released ($0 Remaining in Escrow Vault)'
                            : 'WorkPerHour Escrow Protection Active'}
                        </span>
                        {selectedOrder.status === 'completed'
                          ? `This order is complete and the $${selectedOrder.amount.toLocaleString()} escrow payout has been released to the seller.`
                          : 'Funds are safely locked in escrow and will only be released to the seller once milestones are successfully delivered and approved.'}
                      </div>
                    </div>

                    <div className="space-y-4 mb-6">
                      <h3 className="text-xs font-bold text-fiverr-dark uppercase tracking-wider">Project Requirements</h3>
                      <p className="text-sm text-fiverr-dark bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                        {selectedOrder.requirements || 'No specific requirements notes provided.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <a 
                        href={`/messages/${selectedOrder.id}`}
                        onClick={(e) => navigate(`/messages/${selectedOrder.id}`, e)}
                        className="px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-2"
                      >
                        <MessageSquare className="w-4 h-4 text-emerald-400" />
                        <span>Open Workstream</span>
                      </a>
                      {selectedOrder.status !== 'completed' && selectedOrder.status !== 'cancelled' && (
                        <button 
                          onClick={async () => {
                            const token = getAuthToken();
                            try {
                              const res = await fetch('/api/payments/escrow/release', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                                body: JSON.stringify({ orderId: selectedOrder.id, requestKey: `ui-release-${selectedOrder.id}` })
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                alert(data.error || 'Failed to release escrow funds.');
                                return;
                              }
                              const updated = data.order || { ...selectedOrder, status: 'completed' };
                              setOrders(prev => prev.map(o => o.id === selectedOrder.id ? updated : o));
                              setSelectedOrder(updated);
                              alert('Milestone approved and escrow funds released to seller!');
                            } catch (err) {
                              alert('Network error releasing escrow funds. Please try again.');
                            }
                          }}
                          className="px-5 py-2.5 text-xs font-semibold text-fiverr-dark bg-emerald-400 rounded-xl hover:bg-emerald-300 transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approve & Release Escrow</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-slate-400">Select an order to view escrow details.</div>
                )}
              </div>
            </div>
          </div>
          )
        )}
        
        {/* VIEW 6: WORKSTREAMS & MESSAGES (/messages) */}
        {isMessages && (
          (!currentUser && !impersonatedUser) ? (
            <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-4 shadow-sm">
              <Shield className="w-12 h-12 text-slate-400 mx-auto" />
              <h2 className="text-xl font-bold text-fiverr-dark">Sign in to Access Your Workstreams</h2>
              <p className="text-xs text-fiverr-muted">Track project milestones, real-time workstream messages, and escrow releases.</p>
              <button 
                onClick={() => setIsLoginModalOpen(true)} 
                className="w-full py-2.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition cursor-pointer"
              >
                Sign In to WorkPerHour
              </button>
            </div>
          ) : (
          <Suspense fallback={<div className="py-16 text-center text-slate-400 text-sm">Loading Workstreams...</div>}>
          <div className="bg-slate-50 min-h-[750px] font-sans pb-12">
            {selectedOrder || messageOrderId ? (
              // Active Workstream Workspace View
              (() => {
                const activeWsOrder = hydratedWorkstreamItems.find(w => w.id === (messageOrderId || selectedOrder?.id)) || (selectedOrder ? { ...selectedOrder } : null);
                if (!activeWsOrder) {
                  return (
                    <div className="p-12 text-center bg-white rounded-3xl border border-slate-200">
                      <p className="text-sm font-bold text-fiverr-dark mb-2">Workstream Not Found</p>
                      <button
                        onClick={() => { setSelectedOrder(null); navigate('/messages'); }}
                        className="px-4 py-2 bg-slate-900 text-white font-bold rounded-xl text-xs"
                      >
                        Back to All Workstreams
                      </button>
                    </div>
                  );
                }

                const partnerUser = usersList.find(u => u.id === ((currentUser?.id || impersonatedUser?.id) === activeWsOrder.buyerId ? activeWsOrder.sellerId : activeWsOrder.buyerId));

                return (
                  <WorkstreamWorkspace
                    order={activeWsOrder}
                    messages={messages.filter(m => m.orderId === activeWsOrder.id)}
                    files={hookActiveSharedFiles}
                    currentUser={impersonatedUser || currentUser}
                    usersList={usersList}
                    partner={partnerUser}
                    onBack={() => {
                      setSelectedOrder(null);
                      navigate('/messages');
                    }}
                    onSendMessage={(text) => sendMessage(text, 'message', undefined, activeWsOrder.id)}
                    onRetryMessage={(msg) => retryMessage(msg as any)}
                    onAttachFile={(file) => sendMessage(`Attached file: ${file.name}`, 'file', file, activeWsOrder.id)}
                    onReleaseEscrow={handleReleaseEscrow}
                    onDeliverWork={handleDeliverWork}
                    onRequestRevision={handleRequestRevision}
                    isReviewModalOpen={isReviewModalOpen}
                    setIsReviewModalOpen={setIsReviewModalOpen}
                    handleSubmitReview={handleSubmitReview}
                    reviewError={reviewError}
                    isSubmittingReview={isSubmittingReview}
                    escrowError={escrowError}
                    onViewPartnerProfile={(user) => navigate('/' + (user.username || slugify(user.name)))}
                    onDisputeAssistance={() => navigate('/admin')}
                    onOrderChanged={() => refresh()}
                    sendEvent={sendEvent}
                    onLogRequirement={(text) => console.log('Requirement logged:', text)}
                    onMissedCall={() => console.log('Missed call event')}
                  />
                );
              })()
            ) : (
              // Split Grid: Sidebar + Workstream List View
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1">
                  <WorkstreamSidebar
                    currentTab={workstreamTab}
                    onTabChange={setWorkstreamTab}
                    orders={hydratedWorkstreamItems}
                    starredCount={hydratedWorkstreamItems.filter(o => starredWorkstreams.includes(o.id)).length}
                    projects={projects}
                    usersList={usersList}
                    currentUser={impersonatedUser || currentUser}
                    selectedPersonFilter={selectedPersonFilter}
                    onSelectPersonFilter={setSelectedPersonFilter}
                    peopleSearch={peopleSearch}
                    onPeopleSearchChange={setPeopleSearch}
                    projectSearch={projectFilterSearch}
                    onProjectSelect={setProjectFilterSearch}
                  />
                </div>

                <div className="lg:col-span-3 space-y-4">
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h1 className="text-xl font-bold text-fiverr-dark tracking-tight">
                        My Workstreams
                      </h1>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Manage active client collaborations, deliverable reviews, and secure 100% escrow vault protections.
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => {
                          setWorkstreamTab('all');
                          setSelectedPersonFilter(null);
                          setWorkstreamSearch('');
                          setProjectFilterSearch('');
                        }}
                        className="p-2.5 bg-slate-50 hover:bg-slate-100 text-fiverr-dark rounded-xl border border-slate-200 transition-colors cursor-pointer"
                        title="Reset Filters"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => setIsStartWorkstreamModalOpen(true)}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <PlusCircle className="w-4 h-4" />
                        <span>START NEW WORKSTREAM</span>
                      </button>
                    </div>
                  </div>

                  <WorkstreamList
                    workstreams={filteredWorkstreamItems}
                    selectedOrderId={undefined}
                    onSelectOrder={(orderId) => {
                      const ord = orders.find(o => o.id === orderId);
                      if (ord) setSelectedOrder(ord);
                      navigate(`/messages/${orderId}`);
                    }}
                    starredIds={starredWorkstreams}
                    onToggleStar={(orderId) => {
                      setStarredWorkstreams(prev => 
                        prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
                      );
                    }}
                    searchQuery={workstreamSearch}
                    onSearchChange={setWorkstreamSearch}
                    onStartNewWorkstream={() => setIsStartWorkstreamModalOpen(true)}
                    activeTab={workstreamTab}
                    selectedPersonName={usersList.find(u => u.id === selectedPersonFilter)?.name || null}
                    selectedProjectTitle={projects.find(p => p.id === projectFilterSearch)?.title || (projectFilterSearch || null)}
                    onClearTab={() => setWorkstreamTab('all')}
                    onClearPersonFilter={() => setSelectedPersonFilter(null)}
                    onClearProjectFilter={() => setProjectFilterSearch('')}
                    onClearAllFilters={() => {
                      setWorkstreamTab('all');
                      setSelectedPersonFilter(null);
                      setWorkstreamSearch('');
                      setProjectFilterSearch('');
                    }}
                  />
                </div>
              </div>
            )}

            {/* START NEW WORKSTREAM MODAL */}
            <StartWorkstreamModal
              isOpen={isStartWorkstreamModalOpen}
              onClose={() => setIsStartWorkstreamModalOpen(false)}
              onSubmit={handleStartWorkstreamModalSubmit}
              usersList={usersList}
              currentUser={impersonatedUser || currentUser}
            />
          </div>
          </Suspense>
          )
        )}

        {/* VIEW 7: CREATE GIG STUDIO (/create-gig) */}
        {isCreateGig && (
          <CreateGigView
            newGigTitle={newGigTitle}
            setNewGigTitle={setNewGigTitle}
            newGigCat={newGigCat}
            setNewGigCat={setNewGigCat}
            newGigDesc={newGigDesc}
            setNewGigDesc={setNewGigDesc}
            newGigPrice={newGigPrice}
            setNewGigPrice={setNewGigPrice}
            newGigDays={newGigDays}
            setNewGigDays={setNewGigDays}
            isOptimizingGig={isOptimizingGig}
            handleOptimizeGigWithAI={handleOptimizeGigWithAI}
            newGigExtras={newGigExtras}
            extraTitleInput={extraTitleInput}
            setExtraTitleInput={setExtraTitleInput}
            extraPriceInput={extraPriceInput}
            setExtraPriceInput={setExtraPriceInput}
            handleAddGigExtra={handleAddGigExtra}
            handleRemoveGigExtra={handleRemoveGigExtra}
            handlePublishGig={handlePublishGig}
          />
        )}

        {/* VIEW 8: POST PROJECT STUDIO (/post-project) */}
        {isPostProject && (
          <div className="max-w-2xl mx-auto bg-white rounded-3xl border border-slate-200 p-8 shadow-xs">
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight text-fiverr-dark">Post a Project Request</h1>
              <p className="text-sm text-fiverr-muted">Describe what you need built and receive custom proposals from top freelancers.</p>
            </div>

            <form onSubmit={handlePostProject} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Project Title</label>
                <input 
                  type="text" 
                  placeholder="e.g. Need React Native mobile app developer..."
                  value={newProjTitle}
                  onChange={(e) => setNewProjTitle(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Category</label>
                <select 
                  value={newProjCat}
                  onChange={(e) => setNewProjCat(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none bg-white"
                >
                  <option value="Development & IT">Development & IT</option>
                  <option value="AI & Data">AI & Data</option>
                  <option value="Design & Creative">Design & Creative</option>
                  <option value="Mobile Apps">Mobile Apps</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Project Description</label>
                <textarea 
                  rows={5}
                  placeholder="Detailed requirements, deliverables, and expectations..."
                  value={newProjDesc}
                  onChange={(e) => setNewProjDesc(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Min Budget ($)</label>
                  <input 
                    type="number" 
                    value={newProjMin}
                    onChange={(e) => setNewProjMin(Number(e.target.value))}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-2">Max Budget ($)</label>
                  <input 
                    type="number" 
                    value={newProjMax}
                    onChange={(e) => setNewProjMax(Number(e.target.value))}
                    required
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <button type="submit" className="w-full py-3.5 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors text-sm shadow-md">
                Post Project & Notify Freelancers
              </button>
            </form>
          </div>
        )}
        </>
      )}
      </main>

      <WishlistModal 
        isOpen={isWishlistModalOpen} 
        onClose={() => setIsWishlistModalOpen(false)} 
        likedGigIds={likedGigIds} 
        gigs={gigs} 
        onToggleLike={handleToggleLike} 
        getGigUrl={getGigUrl} 
        navigate={navigate} 
      />

      <EmailNotificationsModal 
        isOpen={isEmailModalOpen} 
        onClose={() => setIsEmailModalOpen(false)} 
        userEmails={userEmails as any} 
        userEmail={(impersonatedUser || currentUser)?.email || ''} 
        onMarkAsRead={async (id) => {
          await fetch(`/api/user-emails/${id}/read`, { method: 'PATCH' });
          const targetUid = (impersonatedUser || currentUser)?.id;
          if (targetUid) fetchUserEmails(targetUid);
        }} 
        onOpenSupport={() => {
          setIsEmailModalOpen(false);
          navigate('/support');
        }} 
      />

      <SupportModal
        isOpen={isSupportModalOpen}
        onClose={() => setIsSupportModalOpen(false)}
        supportSubject={supportSubject}
        setSupportSubject={setSupportSubject}
        supportMessage={supportMessage}
        setSupportMessage={setSupportMessage}
        onSubmitTicket={handleCreateSupportTicket}
        isAppeal={currentUser?.status === 'suspended' || currentUser?.status === 'restricted' || supportSubject.toLowerCase().includes('appeal')}
      />

      <UserSwitchModal
        isOpen={isUserSwitchModalOpen}
        onClose={() => setIsUserSwitchModalOpen(false)}
        usersList={usersList}
        currentUser={currentUser || usersList[0]}
        setCurrentUser={updateCurrentUser}
        setImpersonatedUser={setImpersonatedUser}
        refresh={refresh}
      />

      {/* PROFILE PAGE VIEW (Matches PeoplePerHour design from screenshot exactly) */}
      {isProfilePage && profileUser && !isEditProfile && (
        <FreelancerProfileView 
          profileUser={profileUser}
          currentUser={currentUser}
          gigs={gigs}
          reviews={appReviews}
          onNavigate={navigate}
          onFeatureGig={handleFeatureUserGig}
          onContact={() => handleContactSeller(profileUser.id, profileUser.name, 'General Inquiry')}
          onEditProfile={() => navigate('/edit-profile')}
        />
      )}

      {/* EDIT PROFILE WEBPAGE (/edit-profile or /freelancer/edit) */}
      {isEditProfile && (
        <Suspense fallback={<div className="py-16 text-center text-slate-400 text-sm">Loading Profile Editor...</div>}>
          <EditProfilePage 
            currentUser={currentUser}
            updateCurrentUser={updateCurrentUser}
            navigate={navigate}
          />
        </Suspense>
      )}
      {isPayments && (
        (impersonatedUser || currentUser) ? (
          <div className="max-w-7xl mx-auto px-4 py-8">
            <Suspense fallback={<div className="py-16 text-center text-slate-400 text-sm">Loading Payments & Wallet...</div>}>
              <PaymentsModule 
                gigs={gigs} 
                orders={orders} 
                projects={projects} 
                proposals={proposals} 
                currentUser={(impersonatedUser || currentUser)!} 
                onBalanceUpdate={refresh}
              />
            </Suspense>
          </div>
        ) : (
          <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-3xl text-center space-y-4 shadow-sm">
            <Wallet className="w-12 h-12 text-slate-400 mx-auto" />
            <h2 className="text-xl font-bold text-fiverr-dark">Sign in to Access Payments & Wallet</h2>
            <p className="text-xs text-fiverr-muted">View earnings, available balances, escrow holds, and withdrawal options.</p>
            <button 
              onClick={() => setIsLoginModalOpen(true)} 
              className="w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition cursor-pointer"
            >
              Sign In to WorkPerHour
            </button>
          </div>
        )
      )}

      {/* Footer */}
      <Footer navigate={navigate} />
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        loginRequiresCode={loginRequiresCode}
        loginVerificationMessage={loginVerificationMessage}
        mockEmailCodeDisplay={mockEmailCodeDisplay}
        loginEmail={loginEmail}
        setLoginEmail={setLoginEmail}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        loginCode={loginCode}
        setLoginCode={setLoginCode}
        handleLoginSubmit={handleLoginSubmit}
        setLoginRequiresCode={setLoginRequiresCode}
        usersList={usersList}
        updateCurrentUser={updateCurrentUser}
        setImpersonatedUser={setImpersonatedUser}
        refresh={refresh}
        setIsForgotPasswordModalOpen={setIsForgotPasswordModalOpen}
        setMockEmailCodeDisplay={setMockEmailCodeDisplay}
        loginError={loginError}
        isSubmittingLogin={isSubmittingLogin}
        onSwitchToSignup={() => {
          setIsLoginModalOpen(false);
          setSignupEmail(loginEmail);
          setIsSignupModalOpen(true);
        }}
      />

      <SignupModal
        isOpen={isSignupModalOpen}
        onClose={() => setIsSignupModalOpen(false)}
        handleSignupSubmit={handleSignupSubmit}
        signupName={signupName}
        setSignupName={setSignupName}
        signupEmail={signupEmail}
        setSignupEmail={setSignupEmail}
        signupMobile={signupMobile}
        setSignupMobile={setSignupMobile}
        signupPassword={signupPassword}
        setSignupPassword={setSignupPassword}
        signupConfirmPassword={signupConfirmPassword}
        setSignupConfirmPassword={setSignupConfirmPassword}
        signupError={signupError}
        isSubmittingSignup={isSubmittingSignup}
        onSwitchToLogin={() => {
          setIsSignupModalOpen(false);
          setLoginEmail(signupEmail);
          setIsLoginModalOpen(true);
        }}
      />

      <VerifyModal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        verificationMode={verificationMode}
        setVerificationMode={setVerificationMode}
        emailCodeInput={emailCodeInput}
        setEmailCodeInput={setEmailCodeInput}
        smsCodeInput={smsCodeInput}
        setSmsCodeInput={setSmsCodeInput}
        handleVerifyEmailSubmit={handleVerifyEmailSubmit}
        handleVerifySmsSubmit={handleVerifySmsSubmit}
        handleResendEmailCode={handleResendEmailCode}
        handleResendSmsCode={handleResendSmsCode}
        verifyEmail={verifyEmail}
        verifyMobile={verifyMobile}
        mockEmailCodeDisplay={mockEmailCodeDisplay}
        mockSmsCodeDisplay={mockSmsCodeDisplay}
        onOpenEmailInbox={() => {
          setIsVerifyModalOpen(false);
          setIsEmailModalOpen(true);
        }}
      />

      {/* GLOBAL INSPECT GIG DETAILS MODAL */}
      <ViewingGigModal
        viewingGig={viewingGig}
        onClose={() => setViewingGig(null)}
        onDelete={(id) => {
          handleDeleteGig(id);
          setViewingGig(null);
        }}
        onEdit={(g) => {
          setViewingGig(null);
          handleOpenEditGigModal(g);
        }}
      />

      {/* GLOBAL EDIT GIG DETAILS MODAL */}
      <EditGigModal
        editingGig={editingGig}
        categories={categories}
        onClose={() => setEditingGig(null)}
        onSave={handleSaveEditGig}
        onDelete={(id) => {
          handleDeleteGig(id);
          setEditingGig(null);
        }}
      />

      {/* DELETE GIG CONFIRMATION WARNING MODAL */}
      <DeleteGigModal
        gigToDelete={gigToDelete}
        onClose={() => setGigToDelete(null)}
        onConfirm={handleConfirmDeleteGig}
      />

      {/* DELETE SUCCESS TOAST */}
      {deleteSuccessToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-800 animate-in slide-in-from-bottom duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold">{deleteSuccessToast}</span>
          <button 
            onClick={() => setDeleteSuccessToast(null)}
            className="text-slate-400 hover:text-white text-xs font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ERROR TOAST */}
      {errorToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-red-500/30 animate-in slide-in-from-bottom duration-200">
          <div className="w-2 h-2 rounded-full bg-red-500 shrink-0 animate-pulse" />
          <span className="text-xs font-bold text-red-200">{errorToast}</span>
          <button 
            onClick={() => setErrorToast(null)}
            className="text-slate-400 hover:text-white text-xs font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      <ForgotPasswordModal
        isOpen={isForgotPasswordModalOpen}
        onClose={() => setIsForgotPasswordModalOpen(false)}
        forgotStep={forgotStep}
        setForgotStep={setForgotStep}
        forgotQuery={forgotQuery}
        setForgotQuery={setForgotQuery}
        forgotCode={forgotCode}
        setForgotCode={setForgotCode}
        mockForgotCodeDisplay={mockForgotCodeDisplay}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmNewPassword={confirmNewPassword}
        setConfirmNewPassword={setConfirmNewPassword}
        handleForgotRequest={handleForgotRequest}
        handleForgotVerify={handleForgotVerify}
        handleForgotReset={handleForgotReset}
        setForgotCodeEmpty={() => setForgotCode('')}
      />

      <EditUserProfileModal
        editingUser={editingUser}
        onClose={() => setEditingUser(null)}
        editUserForm={editUserForm}
        setEditUserForm={setEditUserForm}
        handleSaveEditUser={handleSaveEditUser}
      />
    </div>
  );
}

function SuspensionScreen({ user, navigate, onAppeal }: { user: UserAccount, navigate: any, onAppeal: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center animate-in fade-in duration-700">
      <div className="w-24 h-24 bg-rose-50 rounded-3xl flex items-center justify-center mb-8 ring-1 ring-rose-100 shadow-sm">
        <Shield className="w-12 h-12 text-rose-500" />
      </div>
      <h1 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">Account Under Review</h1>
      <p className="text-slate-600 max-w-md text-sm leading-relaxed mb-8">
        Platform administrators have temporarily suspended your access to WorkSphere. 
        <br />
        Reason: <span className="font-bold text-slate-900">{user.flagReason || 'Violation of Marketplace Policies'}</span>
      </p>
      
      <div className="bg-white border border-slate-200 rounded-3xl p-8 shadow-xl max-w-md w-full space-y-6">
        <div className="text-left space-y-3">
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Restricted Actions</h3>
          <ul className="text-xs text-slate-500 space-y-2">
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>Posting new Gigs & Projects</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>Submitting new Proposals or Bids</span>
            </li>
            <li className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
              <span>Initiating withdrawals or fund transfers</span>
            </li>
          </ul>
        </div>
        
        <div className="pt-2">
          <button 
            onClick={onAppeal}
            className="w-full py-3.5 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]"
          >
            <Mail className="w-4 h-4 text-emerald-400" />
            Submit Appeal Request
          </button>
        </div>
      </div>
      
      <div className="mt-10 flex flex-col items-center gap-2">
        <p className="text-xs text-slate-400 font-medium">
          Review usually takes 24-48 business hours.
        </p>
        <button 
          onClick={() => {
            if (typeof window !== 'undefined') {
              localStorage.removeItem('current_user');
              localStorage.removeItem('user');
              window.location.href = '/';
            }
          }}
          className="text-xs font-bold text-slate-500 hover:text-slate-700 underline cursor-pointer"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
