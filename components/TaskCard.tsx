'use client';

import React from 'react';
import {
  Check,
  ExternalLink,
  CalendarPlus,
  Clock,
  MessageSquare,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { parseDueDate, buildGoogleCalendarUrl } from '@/lib/dateUtils';

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
  assignment_id?: string | null;
  class_id?: string | null;
  raw_message_hash: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  is_completed?: boolean;
  completed?: boolean;
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
  const isCompleted = Boolean(
    task.is_completed ?? task.completed ?? (task.status === 'completed')
  );
  const dueInfo = parseDueDate(task.due_date);

  const googleCalUrl = buildGoogleCalendarUrl({
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    source_url: task.source_url,
    course_code: task.course_code,
  });

  const getPriorityInfo = () => {
    if (isCompleted) {
      return {
        label: 'Completed',
        className: 'text-emerald-700 bg-emerald-50/80 border-emerald-200/80',
        dotColor: 'bg-emerald-500',
      };
    }
    if (dueInfo.urgency === 'overdue') {
      return {
        label: 'Overdue',
        className: 'text-rose-700 bg-rose-50/80 border-rose-200/80',
        dotColor: 'bg-rose-500',
      };
    }
    if (dueInfo.urgency === 'today') {
      return {
        label: 'Due Today',
        className: 'text-rose-700 bg-rose-50/80 border-rose-200/80',
        dotColor: 'bg-rose-500',
      };
    }
    if (dueInfo.urgency === 'tomorrow') {
      return {
        label: 'Tomorrow',
        className: 'text-amber-700 bg-amber-50/80 border-amber-200/80',
        dotColor: 'bg-amber-500',
      };
    }
    if (dueInfo.urgency === 'within_7_days') {
      return {
        label: 'This Week',
        className: 'text-amber-700 bg-amber-50/80 border-amber-200/80',
        dotColor: 'bg-amber-500',
      };
    }
    return {
      label: 'Upcoming',
      className: 'text-slate-600 bg-slate-50 border-slate-200/80',
      dotColor: 'bg-slate-400',
    };
  };

  const priorityInfo = getPriorityInfo();
  const isFormal = task.source_type === 'official_assignment';

  const courseClean =
    task.course_name?.trim() ||
    (task.course_code ? task.course_code.replace(/^\[+|\]+$/g, '') : 'General');
  const prefixChar = courseClean.charAt(0).toUpperCase() || 'G';

  const handleOpenInTeams = async (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const extensionId =
      process.env.NEXT_PUBLIC_HARK_EXTENSION_ID?.trim() ||
      (typeof window !== 'undefined' ? localStorage.getItem('hark_local_extension_id')?.trim() : '') ||
      '';

    if (
      typeof window !== 'undefined' &&
      (window as any).chrome?.runtime?.sendMessage &&
      extensionId
    ) {
      try {
        (window as any).chrome.runtime.sendMessage(
          extensionId,
          {
            type: 'NAVIGATE_TO_ASSIGNMENT',
            assignmentId: task.assignment_id || task.id,
            classId: task.class_id,
            title: task.title,
          },
          (response: any) => {
            if ((window as any).chrome.runtime.lastError || !response?.success) {
              window.open('https://teams.microsoft.com/v2/', '_blank', 'noopener,noreferrer');
            }
          }
        );
        return;
      } catch (err) {
        console.warn('Extension message failed, falling back to direct URL', err);
      }
    }
    window.open('https://teams.microsoft.com/v2/', '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-150 ${
        isCompleted
          ? 'border-slate-200/60 bg-slate-50/50 opacity-75'
          : 'border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] hover:border-slate-300 hover:shadow-xs'
      }`}
    >
      {/* Top Header Row: Course Pill + Urgency Badge + Source Type */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="bg-slate-100 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200/60 inline-flex items-center gap-1 max-w-[150px]">
            <span className="w-3.5 h-3.5 rounded bg-[#5C5C99]/15 text-[#292966] text-[9px] font-bold flex items-center justify-center flex-shrink-0">
              {prefixChar}
            </span>
            <span className="truncate">{courseClean}</span>
          </div>

          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shadow-2xs ${priorityInfo.className}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dotColor}`} />
            <span>{priorityInfo.label}</span>
          </div>
        </div>

        {/* Source Badge */}
        <span
          title={isFormal ? 'Official Assignment' : 'Captured from MS Teams Announcement'}
          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200/60 bg-slate-100/70 text-slate-600"
        >
          {isFormal ? (
            <FileText className="w-2.5 h-2.5 text-[#5C5C99]" />
          ) : (
            <MessageSquare className="w-2.5 h-2.5 text-[#5C5C99]" />
          )}
          <span>{isFormal ? 'Assignment' : 'Chat'}</span>
        </span>
      </div>

      {/* Main Body: Checkbox + Title + Description */}
      <div className="flex items-start gap-2.5 mb-4">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => onToggleStatus(task.id, isCompleted ? 'pending' : 'completed')}
          className={`mt-0.5 w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all cursor-pointer focus:outline-none focus:ring-0 flex-shrink-0 ${
            isCompleted
              ? 'bg-[#292966] border-[#292966] text-white shadow-2xs'
              : 'border-slate-300 hover:border-[#292966] bg-white'
          }`}
          title={isCompleted ? 'Mark as pending' : 'Mark as completed'}
        >
          {isCompleted && <Check className="w-3 h-3 stroke-[3]" />}
        </button>

        <div className="flex-1 min-w-0">
          <h3
            className={`text-xs font-semibold leading-snug break-words ${
              isCompleted ? 'line-through text-slate-400' : 'text-slate-900 group-hover:text-[#292966] transition-colors'
            }`}
          >
            {task.title}
          </h3>

          {task.description && (
            <p className="mt-1 text-[11px] text-slate-500 line-clamp-2 leading-relaxed break-words">
              {task.description}
            </p>
          )}

          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 font-mono tabular-nums">
            <span>Due:</span>
            <span
              className={`font-medium ${
                !isCompleted && (dueInfo.urgency === 'overdue' || dueInfo.urgency === 'today')
                  ? 'text-rose-600 font-semibold'
                  : !isCompleted && dueInfo.urgency === 'tomorrow'
                  ? 'text-amber-700 font-semibold'
                  : 'text-slate-600'
              }`}
            >
              {dueInfo.formattedDate}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Action Buttons: Deep Link + Calendar Intent */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-auto gap-2">
        <button
          type="button"
          onClick={handleOpenInTeams}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-[#292966] bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md shadow-2xs transition-all active:scale-[0.98] cursor-pointer"
          title="Open Assignment in Teams"
        >
          <ExternalLink className="w-3 h-3 text-[#5C5C99]" />
          <span>Teams</span>
        </button>

        <a
          href={googleCalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-[#292966] bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md shadow-2xs transition-all active:scale-[0.98]"
          title="Add deadline to Google Calendar"
        >
          <CalendarPlus className="w-3 h-3 text-[#5C5C99]" />
          <span>Add to Cal</span>
        </a>
      </div>
    </div>
  );
};

