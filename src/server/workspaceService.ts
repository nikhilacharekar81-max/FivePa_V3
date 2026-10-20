import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workspace, Order } from '../types.js';

class WorkspaceService {
  private workspaces: Map<string, Workspace> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  public loadFromList(list: any[]) {
    if (Array.isArray(list)) {
      this.workspaces.clear();
      for (const w of list) {
        if (w.workspaceId) this.workspaces.set(w.workspaceId, w);
      }
    }
  }

  public listAll(): Workspace[] {
    return Array.from(this.workspaces.values());
  }

  private loadFromDisk() {
    // Deprecated: Workspaces are now loaded from PostgreSQL via hydrateStoreFromPostgres()
  }

  public saveToDisk() {
    try {
      const list = Array.from(this.workspaces.values());
      import('../../server/db/postgresStore.js').then(({ postgresStore }) => {
        postgresStore.saveWorkspaces(list).catch(err => {
          console.error('[WorkspaceService] Failed to persist workspaces to PostgreSQL:', err);
        });
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to save workspaces:', err);
    }
  }

  public createWorkspace(params: {
    buyerId: string;
    sellerId: string;
    originType: 'gig' | 'project';
    originId: string;
    activeOrderId?: string;
  }): Workspace {
    const workspaceId = 'ws_' + randomUUID().slice(0, 12);
    const workspace: Workspace = {
      workspaceId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      originType: params.originType,
      originId: params.originId,
      createdAt: new Date().toISOString().split('T')[0],
      status: 'active',
      activeOrderId: params.activeOrderId
    };
    this.workspaces.set(workspaceId, workspace);
    this.saveToDisk();
    return workspace;
  }

  public getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  public getWorkspacesForUser(userId: string): Workspace[] {
    return Array.from(this.workspaces.values()).filter(w => w.buyerId === userId || w.sellerId === userId);
  }

  public findWorkspaceByOrder(orderId: string, orders: Order[]): Workspace | undefined {
    const order = orders.find(o => o.id === orderId);
    if (!order) return undefined;
    if (order.workspaceId) {
      return this.workspaces.get(order.workspaceId);
    }
    // Search strictly by activeOrderId or exact project origin
    for (const w of this.workspaces.values()) {
      if (w.activeOrderId === orderId) return w;
      if (order.projectId && w.originType === 'project' && w.originId === order.projectId && w.buyerId === order.buyerId && w.sellerId === order.sellerId) {
        return w;
      }
    }
    return undefined;
  }

  public ensureWorkspaceForOrder(order: Order): Workspace {
    // 1. Explicit workspaceId: reuse it
    if (order.workspaceId && this.workspaces.has(order.workspaceId)) {
      return this.workspaces.get(order.workspaceId)!;
    }

    const originType = order.projectId ? 'project' : 'gig';
    const originId = order.projectId || order.gigId || order.id;

    // 2. Exact Origin Match: If this order belongs to a specific Project or Gig where a Workspace already exists
    let existing: Workspace | undefined;
    const targetOriginId = order.projectId || order.gigId;
    const targetOriginType = order.projectId ? 'project' : 'gig';

    if (targetOriginId) {
      existing = Array.from(this.workspaces.values()).find(w =>
        w.buyerId === order.buyerId &&
        w.sellerId === order.sellerId &&
        w.originType === targetOriginType &&
        w.originId === targetOriginId
      );
    }

    // 3. Active Order Match: If a workspace explicitly lists this order as its activeOrderId
    if (!existing) {
      existing = Array.from(this.workspaces.values()).find(w => w.activeOrderId === order.id);
    }

    // 4. If no exact/known relationship match exists, create a new dedicated Workspace (never guess based on generic buyer+seller alone)
    if (!existing) {
      existing = this.createWorkspace({
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        originType,
        originId,
        activeOrderId: order.id
      });
    }

    order.workspaceId = existing.workspaceId;
    if (!existing.activeOrderId) {
      existing.activeOrderId = order.id;
    }
    this.saveToDisk();
    return existing;
  }

  public migrateLegacyOrders(orders: Order[], dryRun: boolean = false): { migratedCount: number; dryRun: boolean; details: string[] } {
    let migratedCount = 0;
    const details: string[] = [];
    for (const o of orders) {
      if (!o.workspaceId || !this.workspaces.has(o.workspaceId)) {
        migratedCount++;
        if (!dryRun) {
          const ws = this.ensureWorkspaceForOrder(o);
          details.push(`Migrated order ${o.id} to workspace ${ws.workspaceId}`);
        } else {
          details.push(`[DryRun] Would migrate order ${o.id} to workspace for buyer ${o.buyerId} & seller ${o.sellerId}`);
        }
      }
    }
    return { migratedCount, dryRun, details };
  }

  public deleteWorkspace(workspaceId: string) {
    if (this.workspaces.delete(workspaceId)) {
      this.saveToDisk();
    }
  }
}

export const workspaceService = new WorkspaceService();
