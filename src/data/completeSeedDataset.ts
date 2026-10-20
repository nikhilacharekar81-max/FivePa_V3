export const SEED_USERS: any[] = [
  {
    id: 'user_1',
    username: 'alex_dev',
    email: 'alex@example.com',
    role: 'seller',
    sessionVersion: 1,
    knownDevices: ['dev_default_session']
  },
  {
    id: 'user_2',
    username: 'sarah_client',
    email: 'sarah@example.com',
    role: 'buyer',
    sessionVersion: 1,
    knownDevices: ['dev_default_session']
  }
];

export const SEED_GIGS: any[] = [
  {
    id: 'gig_1',
    title: 'Full Stack Web Development',
    slug: 'full-stack-web-development',
    userId: 'user_1',
    sellerId: 'user_1',
    category: 'Development',
    price: 500,
    description: 'Professional full stack development services.',
    createdAt: new Date().toISOString()
  }
];

export const SEED_PROJECTS: any[] = [];
export const SEED_PROPOSALS: any[] = [];
export const SEED_ORDERS: any[] = [];
export const SEED_REVIEWS: any[] = [];
export const SEED_MESSAGES: any[] = [];
