'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  CalendarPlus,
  FileText,
  MessageSquare,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { TaskItem } from '@/components/TaskCard';
import {
  parseDueDate,
  buildGoogleCalendarUrl,
  formatTeamsDeepLink,
  getUrgencyBadgeClasses,
} from '@/lib/dateUtils';

export interface TaskTableRowProps {
  task: TaskItem;
  onToggleStatus: (taskId: string, newStatus: 'pending' | 'completed') => void;
  isUpdating?: boolean;
}

export const TaskTableRow: React.FC<TaskTableRowProps> = ({
  task,
  onToggleStatus,
  isUpdating = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const isCompleted = task.status === 'completed';
  const dueInfo = parseDueDate(task.due_date);
  const isFormal = task.source_type === 'official_assignment';

  const googleCalUrl = buildGoogleCalendarUrl({
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    source_url: task.source_url,
    course_code: task.course_code,
  });

  // Effective deep link resolution with clean fallback to https://teams.microsoft.com/_#/assignments/
  const rawDeepLink = (task.deep_link || (task as any).deepLink || task.source_url || '').trim();
  const isInvalidDeepLink =
    !rawDeepLink ||
    rawDeepLink === '#' ||
    rawDeepLink.startsWith('javascript:') ||
    rawDeepLink.endsWith('/classes/all/list') ||
    rawDeepLink.endsWith('/classes/all/list/') ||
    /^https?:\/\/[^/]+\/classes\/all\/list(?:\?|$)/i.test(rawDeepLink);

  const effectiveDeepLink = isInvalidDeepLink
    ? 'https://teams.microsoft.com/_#/assignments/'
    : rawDeepLink;

  // Dynamic urgency badge colors based on requirements:
  // Red: Due today
  // Yellow: Due tomorrow
  // Blue: Due within 7 days
  // Slate/Neutral: Due in 8+ days
  const getBadgeColorClasses = () => {
    if (isCompleted) {
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    }
    switch (dueInfo.urgency) {
      case 'overdue':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
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

  const hasDescription = Boolean(task.description && task.description.trim().length > 0);

  return (
    <>
      <tr
        className={`group border-b border-slate-800/60 transition-colors duration-150 ${
          isCompleted
            ? 'bg-[#090e18]/40 hover:bg-[#0c1220]/60 opacity-65'
            : 'bg-[#0b101c]/40 hover:bg-[#111827]/70'
        }`}
      >
        {/* 1. Status Checkbox */}
        <td className="py-3 px-3.5 w-12 text-center align-middle">
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => onToggleStatus(task.id, isCompleted ? 'pending' : 'completed')}
            className="text-slate-400 hover:text-indigo-400 focus:outline-none transition-transform active:scale-90 inline-flex items-center justify-center"
            title={isCompleted ? 'Mark as pending' : 'Mark as completed'}
          >
            {isCompleted ? (
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 fill-emerald-500/20" />
            ) : (
              <Circle className="w-4.5 h-4.5 text-slate-500 hover:stroke-indigo-400" />
            )}
          </button>
        </td>

        {/* 2. Assignment Title + Badges */}
        <td className="py-3 px-3.5 align-middle">
          <div className="flex flex-col gap-1 min-w-[200px] max-w-xl">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-semibold text-sm leading-snug break-words ${
                  isCompleted ? 'line-through text-slate-400' : 'text-slate-100'
                }`}
              >
                {task.title}
              </span>

              {/* Subtle Badge: Assignment vs Announcement */}
              <span
                title={isFormal ? 'Official Assignment' : 'Teams Chat Announcement'}
                className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                  isFormal
                    ? 'bg-blue-500/10 text-blue-300 border-blue-500/25'
                    : 'bg-purple-500/10 text-purple-300 border-purple-500/25'
                }`}
              >
                {isFormal ? (
                  <FileText className="w-2.5 h-2.5" />
                ) : (
                  <MessageSquare className="w-2.5 h-2.5" />
                )}
                {isFormal ? 'Assignment' : 'Announcement'}
              </span>

              {/* Optional Expandable Note Toggle */}
              {hasDescription && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-[11px] text-slate-500 hover:text-indigo-400 inline-flex items-center gap-0.5 transition-colors"
                  title="Toggle assignment instructions / notes"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span className="hidden sm:inline">Details</span>
                </button>
              )}
            </div>

            {/* In-row short snippet if collapsed */}
            {!isExpanded && hasDescription && (
              <p className="text-[11px] text-slate-400 line-clamp-1 truncate max-w-lg">
                {task.description}
              </p>
            )}
          </div>
        </td>

        {/* 3. Course Tag / Pill */}
        <td className="py-3 px-3.5 whitespace-nowrap align-middle w-32">
          {task.course_code ? (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono tracking-wide bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 shadow-xs">
              [{task.course_code.replace(/^\[+|\]+$/g, '')}]
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] text-slate-500 bg-slate-800/40 border border-slate-800">
              General
            </span>
          )}
        </td>

        {/* 4. Due Date & Time Formatted Locally */}
        <td className="py-3 px-3.5 whitespace-nowrap align-middle w-48">
          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
            <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span>{dueInfo.formattedDate}</span>
          </div>
        </td>

        {/* 5. Urgency / Countdown Badge */}
        <td className="py-3 px-3.5 whitespace-nowrap align-middle w-44">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getBadgeColorClasses()}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                dueInfo.urgency === 'today'
                  ? 'bg-rose-400 animate-pulse'
                  : dueInfo.urgency === 'tomorrow'
                  ? 'bg-amber-400'
                  : dueInfo.urgency === 'within_7_days'
                  ? 'bg-blue-400'
                  : isCompleted
                  ? 'bg-emerald-400'
                  : 'bg-slate-400'
              }`}
            />
            {dueInfo.urgency === 'overdue' && !isCompleted ? (
              <span className="flex items-center gap-1 font-semibold">
                <AlertCircle className="w-3 h-3 text-rose-400" />
                {dueInfo.countdownText}
              </span>
            ) : isCompleted ? (
              'Completed'
            ) : (
              <span>{dueInfo.countdownText}</span>
            )}
          </span>
        </td>

        {/* 6. Actions: Open in Teams + Google Calendar */}
        <td className="py-3 px-3.5 whitespace-nowrap text-right align-middle w-28">
          <div className="flex items-center justify-end gap-1.5">
            {/* Open in Teams / Portal */}
            <a
              href={effectiveDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center p-1.5 rounded-lg bg-slate-800/80 hover:bg-indigo-600 text-slate-300 hover:text-white border border-slate-700/60 hover:border-indigo-500 transition-all shadow-xs"
              title="Open Assignment in Teams / Portal"
              onClick={(e) => {
                // Allow standard new-tab navigation without preventDefault interfering
                e.stopPropagation();
              }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            {/* Add to Google Calendar */}
            <a
              href={googleCalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Add deadline to Google Calendar"
              className="inline-flex items-center justify-center p-1.5 rounded-lg bg-slate-800/80 hover:bg-emerald-600 text-slate-300 hover:text-white border border-slate-700/60 hover:border-emerald-500 transition-all shadow-xs"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
            </a>
          </div>
        </td>
      </tr>

      {/* Expandable Details Drawer */}
      {isExpanded && hasDescription && (
        <tr className="bg-[#0f172a]/70 border-b border-slate-800/80">
          <td colSpan={6} className="px-5 py-3 text-xs text-slate-300">
            <div className="rounded-lg bg-slate-950/60 p-3 border border-slate-800/70">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-semibold text-indigo-400 uppercase tracking-wider">
                  Instructions & Details
                </span>
                {task.course_name && (
                  <span className="text-[11px] text-slate-400">
                    Course: <strong className="text-slate-200">{task.course_name}</strong>
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-300">
                {task.description}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};
