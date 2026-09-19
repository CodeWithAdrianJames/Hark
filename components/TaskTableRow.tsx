'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Check,
  ExternalLink,
  CalendarPlus,
  FileText,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Flag,
  MoreHorizontal,
} from 'lucide-react';
import { TaskItem } from '@/components/TaskCard';
import {
  parseDueDate,
  buildGoogleCalendarUrl,
} from '@/lib/dateUtils';

export interface TaskTableRowProps {
  task: TaskItem;
  onToggleStatus: (taskId: string, completed: boolean) => void;
  isUpdating?: boolean;
}

export const TaskTableRow: React.FC<TaskTableRowProps> = ({
  task,
  onToggleStatus,
  isUpdating = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const isCompleted = Boolean(
    task.is_completed ?? task.completed ?? (task.status === 'completed')
  );
  const dueInfo = parseDueDate(task.due_date);
  const isFormal = task.source_type === 'official_assignment';

  // Close menus on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const googleCalUrl = buildGoogleCalendarUrl({
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    source_url: task.source_url,
    course_code: task.course_code,
  });

  // Handler to bridge assignment navigation to Hark Chrome Extension or fallback cleanly
  const handleOpenInTeams = async (
    e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const extensionId =
      process.env.NEXT_PUBLIC_HARK_EXTENSION_ID?.trim() ||
      (typeof window !== 'undefined'
        ? localStorage.getItem('hark_local_extension_id')?.trim()
        : '') ||
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
              window.open(
                'https://teams.microsoft.com/v2/',
                '_blank',
                'noopener,noreferrer'
              );
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

  // Formatted Date
  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'No deadline';
    return new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  };

  // Priority / Urgency Flag and Style
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
  const hasDescription = Boolean(task.description && task.description.trim().length > 0);

  // Clean course label and initial
  const courseClean =
    task.course_name?.trim() ||
    (task.course_code ? task.course_code.replace(/^\[+|\]+$/g, '') : 'General');
  const prefixChar = courseClean.charAt(0).toUpperCase() || 'G';

  return (
    <>
      <tr
        className={`group border-b border-slate-200/70 hover:bg-slate-50/80 transition-colors h-12 ${
          isCompleted ? 'bg-slate-50/40 text-slate-400' : 'bg-white text-slate-800'
        }`}
      >
        {/* Checkbox Column */}
        <td className="py-2.5 px-3.5 w-10 text-center align-middle">
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => onToggleStatus(task.id, !isCompleted)}
            className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-all cursor-pointer focus:outline-none focus:ring-0 ${
              isCompleted
                ? 'bg-[#292966] border-[#292966] text-white shadow-2xs'
                : 'border-slate-300 hover:border-[#292966] bg-white'
            }`}
            title={isCompleted ? 'Mark as active' : 'Mark as completed'}
          >
            {isCompleted && <Check className="w-3 h-3 stroke-[3]" />}
          </button>
        </td>

        {/* 1. TASK */}
        <td className="py-2.5 px-3.5 align-middle">
          <div className="flex flex-col gap-0.5 max-w-md">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                onClick={() => hasDescription && setIsExpanded(!isExpanded)}
                className={`text-xs font-semibold leading-snug cursor-pointer transition-colors ${
                  isCompleted
                    ? 'line-through text-slate-400'
                    : 'text-slate-900 group-hover:text-[#292966]'
                }`}
                title={hasDescription ? 'Click to view instructions' : undefined}
              >
                {task.title || 'Untitled Assignment'}
              </span>

              {/* Source Badge */}
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200/60 bg-slate-100/70 text-slate-600"
              >
                {isFormal ? (
                  <FileText className="w-2.5 h-2.5 text-[#5C5C99]" />
                ) : (
                  <MessageSquare className="w-2.5 h-2.5 text-[#5C5C99]" />
                )}
                <span>{isFormal ? 'Assignment' : 'Announcement'}</span>
              </span>

              {/* Expand description toggle */}
              {hasDescription && (
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-[11px] text-[#5C5C99] hover:text-[#292966] inline-flex items-center gap-0.5 transition-colors"
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

            {!isExpanded && hasDescription && (
              <p className="text-[11px] text-slate-500 line-clamp-1 truncate max-w-sm">
                {task.description}
              </p>
            )}
          </div>
        </td>

        {/* 2. COURSE */}
        <td className="py-2.5 px-3.5 whitespace-nowrap align-middle">
          <div className="bg-slate-100 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200/60 inline-flex items-center gap-1.5 max-w-[170px]">
            <span className="w-4 h-4 rounded bg-[#5C5C99]/15 text-[#292966] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
              {prefixChar}
            </span>
            <span className="truncate">{courseClean}</span>
          </div>
        </td>

        {/* 3. DUE DATE */}
        <td className="py-2.5 px-3.5 whitespace-nowrap align-middle">
          <div className="flex flex-col">
            <span
              className={`text-xs font-medium font-mono tabular-nums ${
                !isCompleted && (dueInfo.urgency === 'overdue' || dueInfo.urgency === 'today')
                  ? 'text-rose-600 font-semibold'
                  : !isCompleted && dueInfo.urgency === 'tomorrow'
                  ? 'text-amber-700 font-semibold'
                  : 'text-slate-600'
              }`}
            >
              {formatDateDisplay(task.due_date)}
            </span>
            <span className="text-[10px] text-slate-400">
              {isCompleted ? 'Completed' : dueInfo.countdownText}
            </span>
          </div>
        </td>

        {/* 4. STATUS / URGENCY */}
        <td className="py-2.5 px-3.5 whitespace-nowrap align-middle">
          <div
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shadow-2xs ${priorityInfo.className}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${priorityInfo.dotColor}`} />
            <span>{priorityInfo.label}</span>
          </div>
        </td>

        {/* 5. ACTIONS */}
        <td className="py-2.5 px-3.5 whitespace-nowrap text-right align-middle">
          <div className="flex items-center justify-end gap-1.5">
            {/* Open in Teams tactile ghost button */}
            <button
              type="button"
              onClick={handleOpenInTeams}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-[#292966] bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-md shadow-2xs transition-all active:scale-[0.98] cursor-pointer"
              title="Open in Microsoft Teams"
            >
              <ExternalLink className="w-3 h-3 text-[#5C5C99]" />
              <span>Teams</span>
            </button>

            {/* Quick Actions Menu */}
            <div className="relative inline-block" ref={actionMenuRef}>
              <button
                type="button"
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-[#292966] transition-colors shadow-2xs cursor-pointer"
                title="More options"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {isMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 rounded-xl bg-white border border-slate-200/90 shadow-2xl py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                  <a
                    href={googleCalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-[#292966] transition-colors"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 text-[#5C5C99]" />
                    <span>Add to Calendar</span>
                  </a>
                  {hasDescription && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsExpanded(!isExpanded);
                        setIsMenuOpen(false);
                      }}
                      className="w-full text-left flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-[#292966] transition-colors cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#5C5C99]" />
                      <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                    </button>
                  )}
                  <a
                    href="https://teams.microsoft.com/v2/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 hover:text-[#292966] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-[#5C5C99]" />
                    <span>Teams Web Portal</span>
                  </a>
                </div>
              )}
            </div>
          </div>
        </td>
      </tr>

      {/* Expandable Details Drawer */}
      {isExpanded && hasDescription && (
        <tr className="bg-slate-50/70 border-b border-slate-200/70">
          <td colSpan={6} className="px-5 py-3 text-xs text-slate-800">
            <div className="rounded-xl bg-white p-4 border border-slate-200/70 shadow-2xs">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[11px] font-bold text-[#5C5C99] uppercase tracking-wider">
                  Assignment Instructions &amp; Overview
                </span>
                {task.course_name && (
                  <span className="text-xs text-slate-500">
                    Course: <strong className="text-[#292966] font-semibold">{task.course_name}</strong>
                  </span>
                )}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-700 text-xs">
                {task.description}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};
