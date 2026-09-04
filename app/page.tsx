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
  CheckCircle,
  Inbox,
  Clock,
  KeyRound,
} from 'lucide-react';
import { TaskCard, TaskItem } from '@/components/TaskCard';
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

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(true);

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
    // Check if user ID is stored in localStorage
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
    // 1. Optimistically update local state
    const previousTasks = [...tasks];
    setTasks((current) =>
      current.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    // 2. Dispatch to API
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

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Search filter (title, description, course code)
      const matchesSearch =
        !searchQuery.trim() ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.course_code && task.course_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));

      // Course filter
      const matchesCourse =
        selectedCourse === 'all' ||
        task.course_id === selectedCourse ||
        (task.course_code && task.course_code.toLowerCase() === selectedCourse.toLowerCase());

      return matchesSearch && matchesCourse;
    });
  }, [tasks, searchQuery, selectedCourse]);

  // Kanban Columns partition
  const columns = useMemo(() => {
    const dueTodayOrOverdue: TaskItem[] = [];
    const thisWeek: TaskItem[] = [];
    const later: TaskItem[] = [];
    const completed: TaskItem[] = [];

    for (const task of filteredTasks) {
      if (task.status === 'completed') {
        completed.push(task);
        continue;
      }

      const info = parseDueDate(task.due_date);
      if (info.urgency === 'overdue' || info.urgency === 'today') {
        dueTodayOrOverdue.push(task);
      } else if (info.urgency === 'this_week') {
        thisWeek.push(task);
      } else {
        later.push(task);
      }
    }

    return {
      dueTodayOrOverdue,
      thisWeek,
      later,
      completed,
    };
  }, [filteredTasks]);

  // Metric stats
  const stats = useMemo(() => {
    const totalPending = tasks.filter((t) => t.status !== 'completed').length;
    const overdueCount = tasks.filter(
      (t) => t.status !== 'completed' && parseDueDate(t.due_date).urgency === 'overdue'
    ).length;
    const completedCount = tasks.filter((t) => t.status === 'completed').length;
    const activeCoursesCount = courses.length;

    return { totalPending, overdueCount, completedCount, activeCoursesCount };
  }, [tasks, courses]);

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b0f19]/80 backdrop-blur-md px-4 sm:px-8 py-3.5">
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
                  Dashboard
                </span>
              </div>
              <p className="text-xs text-slate-400">Academic Task & Deadline Hub</p>
            </div>
          </div>

          {/* User ID Card + Actions */}
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
                    className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[11px] font-medium"
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

            {/* Refresh Button */}
            <button
              onClick={() => {
                setIsRefreshing(true);
                fetchTasks(userId, true);
              }}
              disabled={isRefreshing}
              title="Refresh tasks from Neon"
              className="p-2 rounded-lg bg-[#0f172a] hover:bg-slate-800 border border-slate-800 text-slate-300 transition-all hover:border-slate-700"
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
        {/* Metric Summary Bar */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Active Tasks</p>
              <p className="text-xl font-bold text-white mt-0.5">{stats.totalPending}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Inbox className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Urgent / Overdue</p>
              <p className="text-xl font-bold text-rose-400 mt-0.5">{stats.overdueCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Completed</p>
              <p className="text-xl font-bold text-emerald-400 mt-0.5">{stats.completedCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#0f172a]/90 border border-slate-800 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-400">Active Courses</p>
              <p className="text-xl font-bold text-slate-200 mt-0.5">{stats.activeCoursesCount}</p>
            </div>
            <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
        </section>

        {/* Filter Controls Bar */}
        <section className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0d1424] p-3 rounded-xl border border-slate-800/90">
          {/* Search Input */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search assignments or topics..."
              className="w-full bg-[#131b2e] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>

          {/* Filters & Toggles */}
          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
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

            {/* Toggle Completed */}
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showCompleted
                  ? 'bg-slate-800 text-slate-200 border-slate-700'
                  : 'bg-transparent text-slate-500 border-slate-800 hover:text-slate-400'
              }`}
            >
              {showCompleted ? 'Hide Completed' : 'Show Completed'}
            </button>
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

        {/* Kanban Board Columns */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 gap-3">
            <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading tasks from Neon PostgreSQL...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Column 1: Due Today / Overdue */}
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50" />
                  <h2 className="text-sm font-bold text-slate-100">Due Today / Overdue</h2>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                  {columns.dueTodayOrOverdue.length}
                </span>
              </div>

              <div className="flex flex-col gap-3 min-h-[140px]">
                {columns.dueTodayOrOverdue.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800/80 p-8 text-center text-xs text-slate-500">
                    No urgent tasks due today! 🎉
                  </div>
                ) : (
                  columns.dueTodayOrOverdue.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Column 2: This Week */}
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
                  <h2 className="text-sm font-bold text-slate-100">This Week</h2>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {columns.thisWeek.length}
                </span>
              </div>

              <div className="flex flex-col gap-3 min-h-[140px]">
                {columns.thisWeek.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800/80 p-8 text-center text-xs text-slate-500">
                    Nothing due for the rest of the week.
                  </div>
                ) : (
                  columns.thisWeek.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Column 3: Later */}
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                  <h2 className="text-sm font-bold text-slate-100">Later</h2>
                </div>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                  {columns.later.length}
                </span>
              </div>

              <div className="flex flex-col gap-3 min-h-[140px]">
                {columns.later.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800/80 p-8 text-center text-xs text-slate-500">
                    No future deliverables logged yet.
                  </div>
                ) : (
                  columns.later.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onToggleStatus={handleToggleStatus}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Completed Section */}
        {showCompleted && columns.completed.length > 0 && (
          <section className="mt-8 pt-6 border-t border-slate-800/80 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-200">Completed Deliverables</h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {columns.completed.length} completed
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {columns.completed.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onToggleStatus={handleToggleStatus}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Subtle Footer */}
      <footer className="border-t border-slate-800/80 py-4 px-4 sm:px-8 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Hark Academic Assistant &bull; Synchronized with Neon PostgreSQL & Gemini 2.5/3.6 Flash</span>
          <span className="text-slate-600">Companion extension sync active for Microsoft Teams</span>
        </div>
      </footer>
    </div>
  );
}
