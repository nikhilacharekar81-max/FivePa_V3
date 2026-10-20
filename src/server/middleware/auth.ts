import { Request, Response, NextFunction } from 'express';
import { UserAccount } from '../../types';

// Resolve authenticated user identity strictly from verified session (NEVER from client-supplied IDs)
export function resolveAuthenticatedUserId(req: Request): string | null {
  const authUser = (req as any).user?.id || (req as any).authenticatedUserId;
  if (authUser && typeof authUser === 'string' && authUser.trim()) {
    return authUser.trim();
  }
  return null;
}

export const requireAuth = (users: UserAccount[]) => (req: Request, res: Response, next: NextFunction) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Please provide a valid session token.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User account not found.' });
  }
  if (u.status !== 'active') {
    return res.status(403).json({ error: 'Forbidden: Account is suspended, restricted, or deactivated.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
};

const STAFF_ROLES = ['admin', 'super_admin', 'support'];
export function isStaffUser(user: any): boolean {
  return !!user && STAFF_ROLES.includes(user.role);
}

/** Only the order's buyer, its seller, or platform staff may read or write its workstream. */
export function canAccessOrderWorkstream(user: any, order: { buyerId: string; sellerId: string } | undefined): boolean {
  if (!user || !order) return false;
  return isStaffUser(user) || user.id === order.buyerId || user.id === order.sellerId;
}

export const adminActor = (users: UserAccount[]) => (req: Request): string => {
  const authUserId = resolveAuthenticatedUserId(req);
  const u = authUserId ? users.find(user => user.id === authUserId) : null;
  if (u) return `${u.name} (${u.role || 'admin'})`;
  return 'Administrator';
};

export const requireRole = (users: UserAccount[], allowedRoles: string[]) => (req: Request, res: Response, next: NextFunction) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u) {
    return res.status(401).json({ error: 'User not found.' });
  }
  if (!allowedRoles.includes(u.role)) {
    return res.status(403).json({ error: 'Forbidden: Insufficient privileges.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
};

export const requireAdmin = (users: UserAccount[]) => (req: Request, res: Response, next: NextFunction) => {
  const authUserId = resolveAuthenticatedUserId(req);
  if (!authUserId) {
    return res.status(401).json({ error: 'Authentication required. Valid admin session missing.' });
  }
  const u = users.find(user => user.id === authUserId);
  if (!u || (u.role !== 'super_admin' && u.role !== 'admin')) {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  (req as any).authenticatedUserId = u.id;
  (req as any).authenticatedUser = u;
  next();
};
