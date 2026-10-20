import { UserAccount, Gig, Project, Order, Proposal, Review, Message } from '../types';
import {
  SEED_USERS,
  SEED_GIGS,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  SEED_ORDERS,
  SEED_REVIEWS,
  SEED_MESSAGES
} from './completeSeedDataset';

export const initialUsers: UserAccount[] = SEED_USERS;
export const initialGigs: Gig[] = SEED_GIGS;
export const initialProjects: Project[] = SEED_PROJECTS;
export const initialProposals: Proposal[] = SEED_PROPOSALS;
export const initialOrders: Order[] = SEED_ORDERS;
export const initialReviews: Review[] = SEED_REVIEWS;
export const initialMessages: Message[] = SEED_MESSAGES;
