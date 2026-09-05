'use client';

import React from 'react';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  CalendarPlus,
  Clock,
  MessageSquare,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { parseDueDate, buildGoogleCalendarUrl, formatTeamsDeepLink } from '@/lib/dateUtils';

export interface TaskItem {
  id: string;
  user_id: string;
  course_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  source_type: 'official_assignment' | 'chat_announcement' | string;
  source_url: string | null;
  deep_link?: string | null;
  raw_message_hash: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  created_at: string;
  course_code?: string | null;
  course_name?: string | null;
}

interface TaskCardProps {
  task: TaskItem;
  onToggleStatus: (taskId: string, newStatus: 'pending' | 'completed') => void;
  isUpdating?: boolean;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onToggleStatus,
  isUpdating = false,
}) => {
  const isCompleted = task.status === 'completed';
  const dueInfo = parseDueDate(task.due_date);

  const googleCalUrl = buildGoogleCalendarUrl({
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    source_url: task.source_url,
    course_code: task.course_code,
  });

  const getUrgencyBadgeClasses = () => {
    if (isCompleted) {
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
    switch (dueInfo.urgency) {
      case 'overdue':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse';
      case 'today':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      case 'tomorrow':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'within_7_days':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'later':
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700/60';
    }
  };

  const isFormal = task.source_type === 'official_assignment';

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-200 ${
        isCompleted
          ? 'border-slate-800/60 bg-[#0d1322]/60 opacity-60 hover:opacity-100'
          : 'border-slate-800 bg-[#0f172a] shadow-lg shadow-black/30 hover:border-slate-700 hover:shadow-indigo-500/5 hover:-translate-y-0.5'
      }`}
    >
      {/* Top Header Row: Course Code Pill + Urgency Badge + Source Type */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {task.course_code && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              [{task.course_code.replace(/^\[+|\]+$/g, '')}]
            </span>
          )}

          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${getUrgencyBadgeClasses()}`}
          >
            {dueInfo.urgency === 'overdue' && !isCompleted ? (
              <AlertCircle className="w-3 h-3 text-rose-400" />
            ) : (
              <Clock className="w-3 h-3 opacity-70" />
            )}
            {isCompleted ? 'Completed' : dueInfo.countdownText}
          </span>
        </div>

        {/* Source Badge */}
        <span
          title={isFormal ? 'Official Assignment' : 'Captured from MS Teams Announcement'}
          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border ${
            isFormal
              ? 'bg-blue-500/10 text-blue-300 border-blue-500/20'
              : 'bg-purple-500/10 text-purple-300 border-purple-500/20'
          }`}
        >
          {isFormal ? (
            <FileText className="w-3 h-3" />
          ) : (
            <MessageSquare className="w-3 h-3" />
          )}
          {isFormal ? 'Assignment' : 'Teams Chat'}
        </span>
      </div>

      {/* Main Body: Checkbox + Title + Description */}
      <div className="flex items-start gap-3 mb-4">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => onToggleStatus(task.id, isCompleted ? 'pending' : 'completed')}
          className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-indigo-400 focus:outline-none transition-colors"
          title={isCompleted ? 'Mark as pending' : 'Mark as completed'}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 fill-emerald-500/20" />
          ) : (
            <Circle className="w-5 h-5 hover:stroke-indigo-400" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <h3
            className={`text-sm font-semibold leading-snug break-words ${
              isCompleted ? 'line-through text-slate-400' : 'text-slate-100'
            }`}
          >
            {task.title}
          </h3>

          {task.description && (
            <p className="mt-1.5 text-xs text-slate-400 line-clamp-3 leading-relaxed break-words">
              {task.description}
            </p>
          )}

          <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
            <span>Due:</span>
            <span className="text-slate-400 font-medium">{dueInfo.formattedDate}</span>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons: Deep Link + Calendar Intent */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 mt-auto gap-2">
        {(() => {
          const effectiveLink = task.deep_link || task.source_url;
          const teamsUrl = formatTeamsDeepLink(effectiveLink, {
            title: task.title,
            course_code: task.course_code || undefined,
          });
          const finalHref = task.deep_link || (task as any).deepLink || teamsUrl;
          return finalHref ? (
            <a
              href={finalHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Open assignment in Teams"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-indigo-300 transition-colors group/link"
            >
              <ExternalLink className="w-3.5 h-3.5 group-hover/link:translate-x-0.5 transition-transform" />
              <span>Open in Teams</span>
            </a>
          ) : (
            <span className="text-xs text-slate-600">No link provided</span>
          );
        })()}

        <a
          href={googleCalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/60 transition-all hover:border-slate-600"
          title="Add deadline to Google Calendar"
        >
          <CalendarPlus className="w-3.5 h-3.5 text-indigo-400" />
          <span>Add to Cal</span>
        </a>
      </div>
    </div>
  );
};
