import { financeLedger, FinanceLedgerEngine, EscrowRecord, UserWallet, LedgerJournal } from './financeLedger.js';

/**
 * Authoritative Finance Service Layer for WorkPerHour.
 * Acts as the single entry point for all financial operations, escrows, wallet movements, and ledger postings.
 */
class FinanceService {
  public ensureWallet(params: { userId: string; name: string; email: string; role: 'buyer' | 'freelancer' }): void {
    financeLedger.ensureWallet(params);
  }

  public getWalletBalance(userId: string): number | null {
    return financeLedger.getWalletBalance(userId);
  }

  public getWalletById(userId: string) {
    return financeLedger.getWalletById(userId);
  }

  public getWallets() {
    return financeLedger.getWallets();
  }

  public hasWallet(userId: string): boolean {
    return financeLedger.hasWallet(userId);
  }

  public creditDeposit(params: { userId: string; amount: number; reference: string; idempotencyKey: string; actor: string; source?: string }) {
    return financeLedger.creditDeposit(params);
  }

  public fundEscrow(params: { orderId: string; orderTitle: string; amount: number; buyerId: string; sellerId: string; actor: string; timestamp?: string; skipMinimum?: boolean }) {
    return financeLedger.fundEscrow(params);
  }

  public topUpEscrow(params: { orderId: string; orderTitle: string; amount: number; buyerId: string; sellerId: string; actor: string; timestamp?: string; skipMinimum?: boolean }) {
    return financeLedger.topUpEscrow(params);
  }

  public releaseEscrow(params: { orderId: string; actor: string; reason?: string; requestKey?: string }) {
    return financeLedger.releaseEscrow(params);
  }

  public refundEscrow(params: { orderId: string; amount?: number; reason: string; actor: string; requestKey?: string }) {
    return financeLedger.refundEscrow(params);
  }

  public resolveEscrowSplit(params: { orderId: string; refundAmount: number; reason: string; actor: string }) {
    return financeLedger.resolveEscrowSplit(params);
  }

  public requestPayout(params: { payoutId: string; freelancerId: string; amount: number; method: string; accountDetails: string; actor: string }) {
    return financeLedger.requestPayout(params);
  }

  public cancelPayout(params: { payoutId: string; reason: string; actor: string }) {
    return financeLedger.cancelPayout(params);
  }

  public getEscrow(orderId: string): EscrowRecord | undefined {
    return financeLedger.getEscrow(orderId);
  }

  public getEscrows(): EscrowRecord[] {
    return financeLedger.getEscrows();
  }

  public getTransactions() {
    return financeLedger.getTransactions();
  }

  public getAuditLogs() {
    return financeLedger.getAuditLogs();
  }

  public getFeeConfig() {
    return financeLedger.getFeeConfig();
  }

  public quoteOrder(gigPrice: number) {
    return financeLedger.quoteOrder(gigPrice);
  }

  public configure(cfg: any) {
    return financeLedger.configure(cfg);
  }

  public replay<T>(requestKey: string | undefined): T | undefined {
    return financeLedger.replay<T>(requestKey);
  }
}

export const financeService = new FinanceService();
