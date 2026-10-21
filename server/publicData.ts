/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UserAccount, Gig, Project } from '../src/types.js';

const EXCLUDED_STAFF_ROLES = ['admin', 'super_admin', 'support', 'moderator', 'staff', 'internal'];

export function isUserPublic(u: any): boolean {
  if (!u || typeof u !== 'object') return false;

  // Must have active status
  const status = typeof u.status === 'string' ? u.status.trim().toLowerCase() : '';
  if (status !== 'active') return false;

  // Exclude flagged users
  if (u.isFlagged === true || u.flagged === true) return false;

  // Exclude admin, super_admin, support, and other internal/staff roles
  const role = typeof u.role === 'string' ? u.role.trim().toLowerCase() : '';
  if (EXCLUDED_STAFF_ROLES.includes(role)) return false;

  return true;
}

export function sanitizePublicUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    title: user.title,
    avatar: user.avatar,
    rating: user.rating,
    reviewsCount: user.reviewsCount,
    hourlyRate: user.hourlyRate,
    skills: user.skills,
    location: user.location,
    countryFlag: user.countryFlag,
    responseTime: user.responseTime,
    category: user.category,
    subcategory: user.subcategory,
    languages: user.languages,
    certifications: user.certifications,
    isAvailableNow: user.isAvailableNow
  };
}

export function isGigPublic(g: Gig): boolean {
  return g.status === 'published' && (!g.moderationStatus || g.moderationStatus === 'approved');
}

export function sanitizePublicGig(g: Gig) {
  const { moderationStatus, moderationNotes, ...publicGig } = g;
  
  // Auto-expire featured status if past featuredUntil timestamp
  if (publicGig.featured && publicGig.featuredUntil && new Date(publicGig.featuredUntil) < new Date()) {
      publicGig.featured = false;
  }
  
  return publicGig;
}

const PUBLIC_PROJECT_STATUSES = new Set(['open', 'published', 'in_progress']);

export function isProjectPublic(p: Project): boolean {
  if (!p || typeof p !== 'object') return false;
  const status = (p.status || '').toLowerCase();
  if (!PUBLIC_PROJECT_STATUSES.has(status)) return false;

  const modStatus = (p.moderationStatus || '').toLowerCase();
  if (modStatus === 'pending' || modStatus === 'rejected' || modStatus === 'flagged') return false;

  return true;
}

export function sanitizePublicProject(p: Project) {
  const { moderationStatus, moderationNotes, ...publicProject } = p;
  return publicProject;
}
