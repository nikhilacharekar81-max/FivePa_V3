import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  badgeText?: string;
  badgeColor?: string;
  isMono?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  icon: Icon,
  iconColor = 'text-emerald-600',
  badgeText,
  badgeColor = 'text-emerald-600',
  isMono = true
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
      <div className="flex items-center justify-between text-slate-500 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className={`text-2xl font-bold text-fiverr-dark ${isMono ? 'font-mono' : ''}`}>{value}</div>
      {badgeText && (
        <span className={`text-[11px] ${badgeColor} font-semibold mt-1 inline-block`}>{badgeText}</span>
      )}
    </div>
  );
};
