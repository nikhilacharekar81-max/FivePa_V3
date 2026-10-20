import fs from 'fs';
import path from 'path';
import { orders, messages, workstreamUploadIndex, WORKSTREAM_UPLOADS_DIR, Order } from './store.js';

export const WORKSTREAM_FILE_URL_PREFIX = '/api/workstream/files/';

export const STAFF_ROLES = ['admin', 'super_admin', 'support'];

export function isStaffUser(user: any): boolean {
  return !!user && STAFF_ROLES.includes(user.role);
}

/** Only the order's buyer, its seller, or platform staff may read or write its workstream. */
export function canAccessOrderWorkstream(user: any, order: { buyerId: string; sellerId: string } | undefined): boolean {
  if (!user || !order) return false;
  return isStaffUser(user) || user.id === order.buyerId || user.id === order.sellerId;
}

export function workstreamFilenameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(WORKSTREAM_FILE_URL_PREFIX)) return null;
  const name = path.basename(url.slice(WORKSTREAM_FILE_URL_PREFIX.length).split('?')[0]);
  return name || null;
}

/** True when any message, deliverable or delivery record still points at this stored file. */
export function workstreamFileReferencedBy(filename: string): Array<{ buyerId: string; sellerId: string }> {
  const holders: Array<{ buyerId: string; sellerId: string }> = [];
  const matches = (u: unknown) => workstreamFilenameFromUrl(u) === filename;
  for (const o of orders as any[]) {
    const inOrder =
      (Array.isArray(o.deliverableFiles) && o.deliverableFiles.some((f: any) => matches(f?.url))) ||
      (Array.isArray(o.deliveryHistory) && o.deliveryHistory.some((d: any) => Array.isArray(d.files) && d.files.some((f: any) => matches(f?.url)))) ||
      messages.some(m => m.orderId === o.id && matches(m.fileInfo?.url));
    if (inOrder) holders.push({ buyerId: o.buyerId, sellerId: o.sellerId });
  }
  return holders;
}

export function canAccessWorkstreamFile(user: any, filename: string): boolean {
  if (!user) return false;
  if (isStaffUser(user)) return true;
  if (workstreamUploadIndex[filename]?.ownerId === user.id) return true;
  return workstreamFileReferencedBy(filename).some(h => h.buyerId === user.id || h.sellerId === user.id);
}

/** A message attachment must be a file the sender uploaded (or staff attaching one that exists). */
export function validateMessageFileInfo(fileInfo: any, sender: any):
  { ok: true; fileInfo: any } | { ok: false; error: string } {
  if (fileInfo === undefined || fileInfo === null) return { ok: true, fileInfo: undefined };
  if (typeof fileInfo !== 'object') return { ok: false, error: 'Invalid file attachment.' };
  const filename = workstreamFilenameFromUrl(fileInfo.url);
  if (!filename || !fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
    return { ok: false, error: 'Attachments must be uploaded files; placeholder or external URLs are not accepted.' };
  }
  if (!isStaffUser(sender) && workstreamUploadIndex[filename]?.ownerId !== sender.id) {
    return { ok: false, error: 'You can only attach files that you uploaded.' };
  }
  const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
  const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return {
    ok: true,
    fileInfo: {
      name: typeof fileInfo.name === 'string' && fileInfo.name.trim() ? fileInfo.name.trim().slice(0, 200) : filename,
      size,
      url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}`,
      ...(typeof fileInfo.type === 'string' ? { type: fileInfo.type.slice(0, 100) } : {})
    }
  };
}

// Validates that client-submitted file records point at files actually stored by the upload endpoint
// AND uploaded by the submitting user (or staff).
export function validateStoredWorkstreamFiles(raw: any[], submitter?: any): { ok: true; files: Array<{ name: string; size: string; url: string }> } | { ok: false; error: string } {
  const out: Array<{ name: string; size: string; url: string }> = [];
  for (const f of raw) {
    const filename = workstreamFilenameFromUrl(f?.url);
    if (!filename) {
      return { ok: false, error: 'Deliverable files must be uploaded first; placeholder or external URLs are not accepted.' };
    }
    if (!fs.existsSync(path.join(WORKSTREAM_UPLOADS_DIR, filename))) {
      return { ok: false, error: `Uploaded file not found on server: ${filename}` };
    }
    if (submitter && !isStaffUser(submitter) && workstreamUploadIndex[filename]?.ownerId !== submitter.id) {
      return { ok: false, error: 'You can only deliver files that you uploaded.' };
    }
    const bytes = fs.statSync(path.join(WORKSTREAM_UPLOADS_DIR, filename)).size;
    const size = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
    const parts = filename.split('_');
    const fallbackName = parts.length > 2 ? parts.slice(2).join('_') : filename;
    out.push({ name: typeof f?.name === 'string' && f.name.trim() ? f.name.trim().slice(0, 200) : fallbackName, size, url: `${WORKSTREAM_FILE_URL_PREFIX}${filename}` });
  }
  return { ok: true, files: out };
}

export function assertOrderOpen(order: Order) {
  if (order.status === 'completed') throw new Error('Order is already completed; funds were already released.');
  if (order.status === 'cancelled') throw new Error('Order is already cancelled; funds were already handled.');
}
