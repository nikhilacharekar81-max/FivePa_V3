import React, { useState } from 'react';
import { 
  Wallet, DollarSign, ArrowUpRight, ArrowDownLeft, ShieldCheck, 
  CreditCard, Clock, CheckCircle2, AlertCircle, RefreshCw, Download, 
  ExternalLink, Building2, Plus, Filter, ChevronRight
} from 'lucide-react';
import { Gig, Order, Project, Proposal, UserAccount } from '../types';

interface PaymentsModuleProps {
  gigs?: Gig[];
  orders?: Order[];
  projects?: Project[];
  proposals?: Proposal[];
  currentUser?: UserAccount | null;
  onBalanceUpdate?: () => void;
}

export const PaymentsModule: React.FC<PaymentsModuleProps> = ({
  gigs = [],
  orders = [],
  projects = [],
  proposals = [],
  currentUser,
  onBalanceUpdate
}) => {
  const [activeTab, setActiveTab] = useState<'transactions' | 'payouts' | 'methods' | 'invoices'>('transactions');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const walletBalance = currentUser?.walletBalance ?? 0;
  const escrowLocked = orders
    .filter(o => o.status === 'funded_in_escrow' || o.status === 'in_progress')
    .reduce((sum, o) => sum + (o.amount || 0), 0);
  const lifetimeEarnings = currentUser?.earned ?? 0;

  interface TransactionItem {
    id: string;
    date: string;
    description: string;
    amount: number;
    fee: number;
    net: number;
    type: string;
    status: string;
    client: string;
  }

  const mockTransactions: TransactionItem[] = [];

  const handleWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0 || amt > walletBalance) return;
    setIsWithdrawing(true);
    setTimeout(() => {
      setIsWithdrawing(false);
      setWithdrawSuccess(true);
      setWithdrawAmount('');
      if (onBalanceUpdate) onBalanceUpdate();
      setTimeout(() => setWithdrawSuccess(false), 4000);
    }, 1000);
  };

  return (
    <div className="space-y-6">
      {/* Overview Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Available Balance</span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
            ${walletBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            <span>Ready for immediate bank withdrawal</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">In Escrow Protection</span>
            <div className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
            ${escrowLocked.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-blue-600 font-medium">
            <Clock className="w-4 h-4" />
            <span>Secured in smart escrow across active orders</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lifetime Platform Earned</span>
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 tracking-tight">
            ${lifetimeEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span>Verified gross platform turnover</span>
          </div>
        </div>
      </div>

      {/* Withdrawal Action Bar */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-6 text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h3 className="text-lg font-bold">Request Balance Withdrawal</h3>
          <p className="text-xs text-emerald-100 mt-1 max-w-lg">
            Funds are transferred directly via ACH wire or PayPal without hidden conversion fees. Typical clearance is 24-48 business hours.
          </p>
        </div>
        <form onSubmit={handleWithdraw} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 min-w-[320px]">
          <div className="relative flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
            <input
              type="number"
              min="10"
              max={walletBalance}
              step="any"
              placeholder={`Max $${walletBalance.toFixed(2)}`}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="w-full pl-8 pr-4 py-2.5 bg-white text-slate-900 rounded-xl text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-emerald-400 placeholder:text-slate-400"
            />
          </div>
          <button
            type="submit"
            disabled={isWithdrawing || !withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > walletBalance}
            className="px-5 py-2.5 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-black disabled:opacity-40 transition whitespace-nowrap cursor-pointer"
          >
            {isWithdrawing ? 'Processing...' : 'Withdraw Funds'}
          </button>
        </form>
      </div>

      {withdrawSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>Withdrawal payout request submitted successfully! Your account ledger has been scheduled for bank settlement.</span>
        </div>
      )}

      {/* Tabs & Table */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 px-6 pt-4 flex gap-6">
          <button
            onClick={() => setActiveTab('transactions')}
            className={`pb-4 text-xs font-bold border-b-2 transition ${
              activeTab === 'transactions'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Transactions Ledger
          </button>
          <button
            onClick={() => setActiveTab('payouts')}
            className={`pb-4 text-xs font-bold border-b-2 transition ${
              activeTab === 'payouts'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Bank & Payout Accounts
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`pb-4 text-xs font-bold border-b-2 transition ${
              activeTab === 'invoices'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Invoices & Tax Slips
          </button>
        </div>

        {activeTab === 'transactions' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600 border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Tx ID & Date</th>
                  <th className="py-3 px-4">Description / Reference</th>
                  <th className="py-3 px-4">Gross Amount</th>
                  <th className="py-3 px-4">Fee</th>
                  <th className="py-3 px-4">Net Credit/Debit</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mockTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                      No transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  mockTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3.5 px-4 font-mono font-semibold text-slate-800">
                        <div>{tx.id}</div>
                        <div className="text-[11px] text-slate-400 font-sans">{tx.date}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800">{tx.description}</div>
                        <div className="text-[11px] text-slate-400">Party: {tx.client}</div>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-slate-900">${tx.amount.toFixed(2)}</td>
                      <td className="py-3.5 px-4 text-slate-400">${tx.fee.toFixed(2)}</td>
                      <td className="py-3.5 px-4">
                        <span className={`font-bold ${tx.net > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                          {tx.net > 0 ? `+$${tx.net.toFixed(2)}` : `-$${Math.abs(tx.net).toFixed(2)}`}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        {tx.status === 'cleared' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Cleared
                          </span>
                        )}
                        {tx.status === 'completed' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            Settled
                          </span>
                        )}
                        {tx.status === 'escrow_hold' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            In Escrow
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'payouts' && (
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">Linked Payout Accounts</h4>
                <p className="text-xs text-slate-500">Add or manage primary bank and digital wallet destinations</p>
              </div>
              <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                <span>Add Bank / Method</span>
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-xs">JPMorgan Chase & Co (Checking)</div>
                    <div className="text-[11px] text-slate-400">Account ending in •••• 4912 • Primary</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-[10px] font-bold border border-emerald-200">Active</span>
              </div>
              <div className="border border-slate-200 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-900 text-xs">PayPal Business Account</div>
                    <div className="text-[11px] text-slate-400">billing@workperhour.com • Secondary</div>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[10px] font-medium">Backup</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <Download className="w-8 h-8 mx-auto text-slate-300" />
            <h5 className="font-bold text-slate-700 text-sm">Download Monthly Statement Reports</h5>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">Generate certified PDFs for tax compliance and VAT deductions.</p>
            <button className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-200 transition mt-2">
              Export 2026 Fiscal Year (PDF)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
