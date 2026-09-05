'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Search,
  Filter,
  Download,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Calendar,
  Layers,
  CheckCircle2,
  Inbox,
  Clock,
  KeyRound,
  ChevronDown,
  ChevronUp,
  ListFilter,
  ArrowUpDown,
} from 'lucide-react';
import { TaskItem } from '@/components/TaskCard';
import { TaskTableRow } from '@/components/TaskTableRow';
import { ExtensionBanner, ExtensionStatusBadge } from '@/components/ExtensionBanner';
import { useHarkExtension } from '@/hooks/useHarkExtension';
import { parseDueDate, exportToICS } from '@/lib/dateUtils';

interface Course {
  id: string;
  code: string;
  name: string;
  channel_id: string | null;
}

const DEFAULT_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

export default function StudentDashboardPage() {
  // State
  const [userId, setUserId] = useState<string>(DEFAULT_USER_ID);
  const [inputUserId, setInputUserId] = useState<string>(DEFAULT_USER_ID);
  const [isEditingUser, setIsEditingUser] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // Hark Chrome Extension Auto-Detection & Pairing
  const extensionState = useHarkExtension(userId);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Controls
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [isCompletedExpanded, setIsCompletedExpanded] = useState<boolean>(false);

  // Fetch tasks for current user
  const fetchTasks = useCallback(
    async (targetUserId: string, silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/tasks?userId=${encodeURIComponent(targetUserId)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}: Failed to load tasks`);
        }

        const data = await res.json();
        setTasks(data.tasks || []);
        setCourses(data.courses || []);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to connect to database';
        setError(msg);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  // Initial load
  useEffect(() => {
    const saved = localStorage.getItem('hark_dashboard_user_id');
    const effectiveId = saved || DEFAULT_USER_ID;
    setUserId(effectiveId);
    setInputUserId(effectiveId);
    fetchTasks(effectiveId);
  }, [fetchTasks]);

  // Handle switching user ID
  const handleSaveUserId = () => {
    const trimmed = inputUserId.trim();
    if (!trimmed) return;
    setUserId(trimmed);
    localStorage.setItem('hark_dashboard_user_id', trimmed);
    setIsEditingUser(false);
    fetchTasks(trimmed);
  };

  // Copy UUID to clipboard
  const handleCopyKey = () => {
    navigator.clipboard.writeText(userId);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Optimistic status update handler
  const handleToggleStatus = async (taskId: string, newStatus: 'pending' | 'completed') => {
    const previousTasks = [...tasks];
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: taskId, status: newStatus }),
      });

      if (!res.ok) {
        throw new Error('Failed to update task status.');
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
      // Revert local state on failure
      setTasks(previousTasks);
    }
  };

  // Export pending tasks to .ics
  const handleExportICS = () => {
    const pendingTasks = tasks.filter((t) => t.status !== 'completed');
    if (pendingTasks.length === 0) {
      alert('No pending tasks to export!');
      return;
    }
    exportToICS(pendingTasks);
  };

  // Filter tasks based on search & selected course
  const { upcomingTasks, completedTasks } = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    const matchesFilter = (task: TaskItem) => {
      const matchesSearch =
        !search ||
        task.title.toLowerCase().includes(search) ||
        (task.course_code && task.course_code.toLowerCase().includes(search)) ||
        (task.course_name && task.course_name.toLowerCase().includes(search)) ||
        (task.description && task.description.toLowerCase().includes(search));

      const matchesCourse =
        selectedCourse === 'all' ||
        task.course_id === selectedCourse ||
        (task.course_code && task.course_code.toLowerCase() === selectedCourse.toLowerCase());

      return matchesSearch && matchesCourse;
    };

    const upcoming: TaskItem[] = [];
    const completed: TaskItem[] = [];

    for (const task of tasks) {
      if (!matchesFilter(task)) continue;
      if (task.status === 'completed') {
        completed.push(task);
      } else {
        upcoming.push(task);
      }
    }

    // Default Sorting: Ascending by due date (nearest deadlines first)
    upcoming.sort((a, b) => {
      const timeA = new Date(a.due_date).getTime() || 0;
      const timeB = new Date(b.due_date).getTime() || 0;
      return timeA - timeB;
    });

    completed.sort((a, b) => {
      const timeA = new Date(a.due_date).getTime() || 0;
      const timeB = new Date(b.due_date).getTime() || 0;
      return timeA - timeB;
    });

    return { upcomingTasks: upcoming, completedTasks: completed };
  }, [tasks, searchQuery, selectedCourse]);

  // Overall metric stats
  const stats = useMemo(() => {
    const totalPending = tasks.filter((t) => t.status !== 'completed').length;
    const dueTodayCount = tasks.filter(
      (t) => t.status !== 'completed' && parseDueDate(t.due_date).urgency === 'today'
    ).length;
    const dueTomorrowCount = tasks.filter(
      (t) => t.status !== 'completed' && parseDueDate(t.due_date).urgency === 'tomorrow'
    ).length;
    const completedCount = tasks.filter((t) => t.status === 'completed').length;

    return { totalPending, dueTodayCount, dueTomorrowCount, completedCount };
  }, [tasks]);

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b0f19]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 shadow-md shadow-black/20">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Logo Branding */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">Hark</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Data Table
                </span>
              </div>
              <p className="text-xs text-slate-400">Academic Task & Deadline Hub</p>
            </div>
          </div>

          {/* User ID Card + Global Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* User Token Display Card */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0f172a] border border-slate-800 text-xs">
              <KeyRound className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              {isEditingUser ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={inputUserId}
                    onChange={(e) => setInputUserId(e.target.value)}
                    placeholder="Enter UUID..."
                    className="w-48 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs text-white outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={handleSaveUserId}
                    className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-medium transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setInputUserId(userId);
                      setIsEditingUser(false);
                    }}
                    className="px-1.5 py-0.5 text-slate-400 hover:text-slate-200 text-[11px]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 hidden sm:inline">User ID:</span>
                  <code
                    onClick={() => setIsEditingUser(true)}
                    title="Click to edit user UUID"
                    className="cursor-pointer text-indigo-300 font-mono font-medium hover:underline"
                  >
                    {userId ? `${userId.slice(0, 8)}...${userId.slice(-4)}` : 'None'}
                  </code>
                  <button
                    onClick={handleCopyKey}
                    title="Copy UUID to paste into Chrome Extension"
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {copiedKey ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Chrome Extension Status Indicator */}
            <ExtensionStatusBadge extensionState={extensionState} />

            {/* Refresh Button */}
            <button
              onClick={() => {
                setIsRefreshing(true);
                fetchTasks(userId, true);
              }}
              disabled={isRefreshing}
              title="Refresh tasks from Neon PostgreSQL"
              className="p-2 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-800 text-slate-300 transition-all hover:border-slate-700 active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>

            {/* Export All to .ICS Button */}
            <button
              onClick={handleExportICS}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export .ICS</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 flex flex-col gap-6">
        {/* Chrome Extension Onboarding Banner */}
        <ExtensionBanner extensionState={extensionState} activeUserId={userId} />

        {/* Metric Summary Bar */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* Active Upcoming Counter */}
          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-medium text-slate-400">Total Upcoming</p>
              <p className="text-2xl font-bold text-white mt-0.5">{stats.totalPending}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Inbox className="w-4.5 h-4.5" />
            </div>
          </div>

          {/* Due Today (Red) */}
          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-medium text-slate-400">Due Today</p>
              <p className="text-2xl font-bold text-rose-400 mt-0.5">{stats.dueTodayCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-4.5 h-4.5" />
            </div>
          </div>

          {/* Due Tomorrow (Yellow) */}
          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-medium text-slate-400">Due Tomorrow</p>
              <p className="text-2xl font-bold text-amber-400 mt-0.5">{stats.dueTomorrowCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Clock className="w-4.5 h-4.5" />
            </div>
          </div>

          {/* Completed */}
          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between shadow-xs">
            <div>
              <p className="text-xs font-medium text-slate-400">Completed</p>
              <p className="text-2xl font-bold text-emerald-400 mt-0.5">{stats.completedCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4.5 h-4.5" />
            </div>
          </div>
        </section>

        {/* Filter Controls Header Bar */}
        <section className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0d1424] p-3 rounded-xl border border-slate-800/90 shadow-xs">
          {/* Real-Time Search Input */}
          <div className="relative w-full sm:w-84">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assignments, courses, or notes..."
              className="w-full bg-[#131b2e] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>

          {/* Controls: Course Filter Dropdown & Upcoming Counter */}
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
            {/* Course Filter Dropdown */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                className="bg-[#131b2e] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">All Courses ({tasks.length})</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Active Counter Badge */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <span>{upcomingTasks.length} Upcoming</span>
            </div>
          </div>
        </section>

        {/* Error Notification */}
        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchTasks(userId)}
              className="underline font-semibold hover:text-rose-200"
            >
              Retry
            </button>
          </div>
        )}

        {/* Primary Horizontal Data Table */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading assignments from Neon PostgreSQL...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Upcoming Assignments Table Container */}
            <div className="rounded-xl border border-slate-800 bg-[#0d1424]/90 overflow-hidden shadow-xl shadow-black/30">
              {/* Table Title Bar */}
              <div className="px-4 py-3 border-b border-slate-800/80 bg-[#0f172a] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
                  <h2 className="text-sm font-bold text-slate-100">Upcoming Assignments</h2>
                  <span className="ml-1 text-xs text-slate-400">
                    ({upcomingTasks.length} deliverables)
                  </span>
                </div>
                <span className="text-[11px] text-slate-400 hidden sm:inline flex items-center gap-1">
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                  Sorted by nearest deadline
                </span>
              </div>

              {/* Responsive Table Wrapper */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-[#0b0f19]/80">
                      <th className="py-2.5 px-3.5 w-12 text-center">Status</th>
                      <th className="py-2.5 px-3.5">Assignment Title</th>
                      <th className="py-2.5 px-3.5 w-32">Course</th>
                      <th className="py-2.5 px-3.5 w-48">Due Date & Time</th>
                      <th className="py-2.5 px-3.5 w-44">Urgency</th>
                      <th className="py-2.5 px-3.5 w-28 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingTasks.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-xs text-slate-500">
                          {searchQuery || selectedCourse !== 'all' ? (
                            <div className="flex flex-col items-center gap-1">
                              <p className="font-medium text-slate-400">No assignments match your active filters.</p>
                              <p className="text-[11px] text-slate-500">Try clearing your search query or selecting "All Courses".</p>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <p className="font-medium text-slate-400">No upcoming assignments found! 🎉</p>
                              <p className="text-[11px] text-slate-500">
                                Scan your MS Teams course channels with the Hark extension to ingest upcoming deadlines.
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : (
                      upcomingTasks.map((task) => (
                        <TaskTableRow
                          key={task.id}
                          task={task}
                          onToggleStatus={handleToggleStatus}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Collapsible Completed Tasks Section */}
            {completedTasks.length > 0 && (
              <div className="rounded-xl border border-slate-800/80 bg-[#0b1019]/70 overflow-hidden transition-all duration-200">
                {/* Collapsible Header Accordion Toggle */}
                <button
                  type="button"
                  onClick={() => setIsCompletedExpanded(!isCompletedExpanded)}
                  className="w-full px-4 py-3 bg-[#0d1424]/60 hover:bg-[#0f172a] border-b border-slate-800/70 flex items-center justify-between text-left transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-slate-200">Completed Assignments</h3>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {completedTasks.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
                    <span>{isCompletedExpanded ? 'Collapse' : 'Expand'}</span>
                    {isCompletedExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </button>

                {/* Collapsible Table Body */}
                {isCompletedExpanded && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider bg-[#080d16]/80">
                          <th className="py-2.5 px-3.5 w-12 text-center">Status</th>
                          <th className="py-2.5 px-3.5">Assignment Title</th>
                          <th className="py-2.5 px-3.5 w-32">Course</th>
                          <th className="py-2.5 px-3.5 w-48">Due Date & Time</th>
                          <th className="py-2.5 px-3.5 w-44">Status</th>
                          <th className="py-2.5 px-3.5 w-28 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {completedTasks.map((task) => (
                          <TaskTableRow
                            key={task.id}
                            task={task}
                            onToggleStatus={handleToggleStatus}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Subtle Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-4 sm:px-8 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Hark Academic Assistant &bull; Synchronized with Neon PostgreSQL & Gemini AI</span>
          <span className="text-slate-600">Companion extension sync active for Microsoft Teams</span>
        </div>
      </footer>
    </div>
  );
}
