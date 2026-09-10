'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  CheckCircle2,
  Inbox,
  Clock,
  KeyRound,
  ChevronDown,
  ChevronsUpDown,
  ArrowUpDown,
  BookOpen,
  CheckSquare,
  Settings,
  X,
  Menu,
  ExternalLink,
  Plus,
  Layers,
  GraduationCap,
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
  task_count?: number;
  created_at?: string;
}

const DEFAULT_USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

export default function StudentDashboardPage() {
  // User ID State
  const [userId, setUserId] = useState<string>(DEFAULT_USER_ID);
  const [inputUserId, setInputUserId] = useState<string>(DEFAULT_USER_ID);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [showUserModal, setShowUserModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Hark Chrome Extension Auto-Detection & Pairing
  const extensionState = useHarkExtension(userId);

  // Data State
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Layout: strictly TWO consolidated views: 'assignments' and 'courses'
  const [activeMainTab, setActiveMainTab] = useState<'assignments' | 'courses'>('assignments');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Assignments segmented control: 'all' | 'active' | 'completed' (default: 'all' for instant visibility)
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'active' | 'completed'>('all');

  // Filter & Search Controls
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [sortOption, setSortOption] = useState<'deadline_asc' | 'deadline_desc' | 'title_asc' | 'priority'>('deadline_asc');
  const [showFilterDropdown, setShowFilterDropdown] = useState<boolean>(false);
  const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Fetch tasks and courses for current user
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
    const effectiveId = saved && saved.trim().length > 10 ? saved.trim() : DEFAULT_USER_ID;
    setUserId(effectiveId);
    setInputUserId(effectiveId);
    fetchTasks(effectiveId);
  }, [fetchTasks]);

  // Auto-refresh task table when cross-tab MS Teams sync succeeds
  useEffect(() => {
    if (extensionState.syncStatus === 'SUCCESS') {
      fetchTasks(userId, true);
    }
  }, [extensionState.syncStatus, userId, fetchTasks]);

  // Keyboard shortcut: Cmd/Ctrl + F to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close filter/sort dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle saving switched user ID
  const handleSaveUserId = () => {
    const trimmed = inputUserId.trim();
    if (!trimmed) return;
    setUserId(trimmed);
    localStorage.setItem('hark_dashboard_user_id', trimmed);
    setShowUserModal(false);
    setShowSettingsModal(false);
    fetchTasks(trimmed);
  };

  // Copy UUID to clipboard
  const handleCopyKey = () => {
    navigator.clipboard.writeText(userId);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Interactive Checkbox Toggle Handler with Optimistic UI + Database Mutation
  const handleToggleTaskStatus = async (taskId: string, completed: boolean) => {
    const previousTasks = [...tasks];
    const newStatus = completed ? 'completed' : 'pending';

    // 1. Optimistic UI update
    setTasks((current) =>
      current.map((t) =>
        t.id === taskId
          ? {
              ...t,
              is_completed: completed,
              completed: completed,
              status: newStatus,
            }
          : t
      )
    );

    // 2. Persist to Neon PostgreSQL via /api/tasks/status
    try {
      const res = await fetch('/api/tasks/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, completed }),
      });

      if (!res.ok) {
        throw new Error('Failed to update task status.');
      }
    } catch (err) {
      console.error('Failed to update status in DB:', err);
      // Rollback optimistic update on error
      setTasks(previousTasks);
    }
  };

  // Export pending tasks to .ics
  const handleExportICS = () => {
    const pendingTasks = tasks.filter(
      (t) => !(t.is_completed ?? t.completed ?? t.status === 'completed')
    );
    if (pendingTasks.length === 0) {
      alert('No active tasks to export!');
      return;
    }
    exportToICS(pendingTasks);
  };

  // Trigger MS Teams auto sync or manual refresh
  const handleSyncWithTeams = () => {
    setIsRefreshing(true);
    if (extensionState.isInstalled) {
      extensionState.triggerAutoSync();
    }
    fetchTasks(userId, true);
  };

  // Metric stats
  const stats = useMemo(() => {
    const totalPending = tasks.filter(
      (t) => !(t.is_completed ?? t.completed ?? t.status === 'completed')
    ).length;
    const dueTodayCount = tasks.filter(
      (t) =>
        !(t.is_completed ?? t.completed ?? t.status === 'completed') &&
        parseDueDate(t.due_date).urgency === 'today'
    ).length;
    const dueTomorrowCount = tasks.filter(
      (t) =>
        !(t.is_completed ?? t.completed ?? t.status === 'completed') &&
        parseDueDate(t.due_date).urgency === 'tomorrow'
    ).length;
    const completedCount = tasks.filter(
      (t) => Boolean(t.is_completed ?? t.completed ?? t.status === 'completed')
    ).length;

    return { totalPending, dueTodayCount, dueTomorrowCount, completedCount, total: tasks.length };
  }, [tasks]);

  // Filtered & Sorted Tasks based on segmented control, search, and course
  const filteredTasks = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    const result = tasks.filter((task) => {
      const isComp = Boolean(task.is_completed ?? task.completed ?? task.status === 'completed');

      // 1. Segmented Control filter ('all' | 'active' | 'completed')
      if (segmentFilter === 'active' && isComp) return false;
      if (segmentFilter === 'completed' && !isComp) return false;

      // 2. Search filter
      const matchesSearch =
        !search ||
        task.title.toLowerCase().includes(search) ||
        (task.course_code && task.course_code.toLowerCase().includes(search)) ||
        (task.course_name && task.course_name.toLowerCase().includes(search)) ||
        (task.description && task.description.toLowerCase().includes(search));

      // 3. Course filter
      const matchesCourse =
        selectedCourse === 'all' ||
        task.course_id === selectedCourse ||
        (task.course_code && task.course_code.toLowerCase() === selectedCourse.toLowerCase());

      return matchesSearch && matchesCourse;
    });

    // Sorting
    result.sort((a, b) => {
      if (sortOption === 'title_asc') {
        return a.title.localeCompare(b.title);
      }
      if (sortOption === 'deadline_desc') {
        const timeA = new Date(a.due_date).getTime() || 0;
        const timeB = new Date(b.due_date).getTime() || 0;
        return timeB - timeA;
      }
      if (sortOption === 'priority') {
        const order = { overdue: 0, today: 1, tomorrow: 2, within_7_days: 3, later: 4 };
        const urgA = order[parseDueDate(a.due_date).urgency] ?? 5;
        const urgB = order[parseDueDate(b.due_date).urgency] ?? 5;
        return urgA - urgB;
      }
      // default: deadline_asc
      const timeA = new Date(a.due_date).getTime() || 0;
      const timeB = new Date(b.due_date).getTime() || 0;
      return timeA - timeB;
    });

    return result;
  }, [tasks, segmentFilter, searchQuery, selectedCourse, sortOption]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [segmentFilter, searchQuery, selectedCourse, sortOption]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, currentPage, pageSize]);

  return (
    <div className="min-h-screen bg-[#F8F9FC] text-slate-800 flex font-sans antialiased selection:bg-[#CCCCFF] selection:text-[#292966]">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden backdrop-blur-xs"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 1. Left Sidebar: strictly TWO main views (Assignments, Courses / Teams) */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-white border-r border-slate-200/80 flex flex-col justify-between transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* App Brand Header */}
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#292966] flex items-center justify-center text-white shadow-xs">
                <Sparkles className="w-4 h-4 text-[#CCCCFF]" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-base text-[#292966] tracking-tight leading-none">
                  Hark
                </span>
                <span className="text-[10px] font-medium text-[#5C5C99] tracking-wider uppercase mt-1">
                  Academic Tasks
                </span>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Workspace Selector Pill */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#F8F9FC] border border-slate-200/80 hover:border-[#CCCCFF] transition-colors cursor-pointer group">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-md bg-[#CCCCFF]/40 text-[#292966] font-bold text-xs flex items-center justify-center flex-shrink-0">
                  C
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-xs font-semibold text-[#292966] truncate">
                    CIT - University
                  </span>
                  <span className="text-[10px] text-slate-400">Student Workspace</span>
                </div>
              </div>
              <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#292966] flex-shrink-0 transition-colors" />
            </div>
          </div>

          {/* Navigation Group: Strictly TWO main views */}
          <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
            {/* 1. Assignments */}
            <button
              type="button"
              onClick={() => setActiveMainTab('assignments')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeMainTab === 'assignments'
                  ? 'bg-[#CCCCFF]/25 text-[#292966] font-semibold shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#292966]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CheckSquare className={`w-4 h-4 ${activeMainTab === 'assignments' ? 'text-[#292966]' : 'text-slate-400'}`} />
                <span>Assignments</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#CCCCFF]/40 text-[#292966]">
                {stats.totalPending}
              </span>
            </button>

            {/* 2. Courses / Teams */}
            <button
              type="button"
              onClick={() => setActiveMainTab('courses')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeMainTab === 'courses'
                  ? 'bg-[#CCCCFF]/25 text-[#292966] font-semibold shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-[#292966]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <BookOpen className={`w-4 h-4 ${activeMainTab === 'courses' ? 'text-[#292966]' : 'text-slate-400'}`} />
                <span>Courses / Teams</span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">
                {courses.length}
              </span>
            </button>
          </nav>

          {/* Bottom Section: Extension Sync Status Card */}
          <div className="p-3 border-t border-slate-100">
            <div className="p-3 rounded-lg bg-[#F8F9FC] border border-slate-200/80 flex flex-col gap-2 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      extensionState.isInstalled ? 'bg-emerald-500' : 'bg-amber-400'
                    }`}
                  />
                  <span className="text-xs font-semibold text-[#292966]">
                    {extensionState.isInstalled
                      ? 'Teams Extension Connected'
                      : 'Extension Pairing'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSyncWithTeams}
                  disabled={isRefreshing}
                  title="Re-sync assignments from MS Teams"
                  className="p-1 rounded hover:bg-white text-slate-400 hover:text-[#292966] transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#292966]' : ''}`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>{extensionState.isInstalled ? 'Auto-sync active' : 'Not detected'}</span>
                <span className="text-[10px] text-slate-400">
                  {extensionState.isInstalled ? `v${extensionState.version || '1.0'}` : 'Pair now'}
                </span>
              </div>

              {!extensionState.isInstalled && (
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(true)}
                  className="mt-1 w-full py-1.5 px-2 rounded-md bg-[#292966] text-white text-xs font-medium hover:bg-[#1E1E4F] transition-colors text-center"
                >
                  Pair Extension
                </button>
              )}
            </div>

            {/* Student Profile Bar */}
            <div className="mt-2.5 flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2 truncate">
                <div className="w-6 h-6 rounded-full bg-[#292966] text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                  AJ
                </div>
                <div className="flex flex-col truncate">
                  <span className="text-xs font-semibold text-slate-800 truncate">
                    Adrian James
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono truncate">
                    {userId.slice(0, 8)}...
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                title="Account Settings"
                className="p-1 text-slate-400 hover:text-[#292966] transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Layout */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between gap-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          {/* Mobile menu trigger + Quick Search */}
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-50"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Quick Search Bar */}
            <div className="relative w-full max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assignments, courses, notes..."
                className="w-full bg-[#F8F9FC] border border-slate-200 focus:border-[#292966] focus:bg-white rounded-lg pl-9 pr-14 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-mono text-slate-400">
                ⌘ F
              </span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2.5">
            {/* Sync with Teams action button */}
            <button
              type="button"
              onClick={handleSyncWithTeams}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors shadow-2xs active:scale-95"
              title="Sync assignments from MS Teams"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#5C5C99] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync with Teams</span>
            </button>

            {/* Settings gear icon */}
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              title="Settings &amp; Pairing"
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-[#292966] transition-colors"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* User Profile Avatar Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserModal(!showUserModal)}
                className="flex items-center gap-1.5 p-1 pl-1.5 pr-2 rounded-full border border-slate-200 hover:border-[#CCCCFF] transition-all bg-white"
              >
                <div className="w-6 h-6 rounded-full bg-[#292966] text-white font-bold text-[10px] flex items-center justify-center">
                  AJ
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {showUserModal && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white border border-slate-200/90 shadow-xl p-3 z-40 text-xs flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-100">
                  <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                    <div className="w-7 h-7 rounded-full bg-[#292966] text-white font-bold text-xs flex items-center justify-center">
                      AJ
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800">Adrian James</span>
                      <span className="text-[11px] text-slate-400">CIT - University</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 font-medium">User UUID:</span>
                    <div className="flex items-center justify-between p-1.5 rounded bg-slate-50 border border-slate-200/80 font-mono text-[11px] text-slate-700">
                      <span className="truncate">{userId}</span>
                      <button
                        type="button"
                        onClick={handleCopyKey}
                        className="p-1 hover:bg-[#CCCCFF]/30 rounded text-slate-400 hover:text-[#292966]"
                        title="Copy UUID"
                      >
                        {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowUserModal(false);
                      setShowSettingsModal(true);
                    }}
                    className="w-full py-1.5 rounded-lg bg-slate-50 hover:bg-[#CCCCFF]/20 text-slate-700 hover:text-[#292966] font-medium text-center border border-slate-200 transition-colors"
                  >
                    Manage Account &amp; Sync
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main View Area */}
        <main className="flex-1 px-4 sm:px-8 py-6 flex flex-col gap-6 max-w-7xl w-full mx-auto">
          {/* Extension Onboarding Banner */}
          <ExtensionBanner extensionState={extensionState} activeUserId={userId} />

          {/* VIEW 1: ASSIGNMENTS VIEW */}
          {activeMainTab === 'assignments' && (
            <div className="flex flex-col gap-6">
              {/* Metric / Stat Cards */}
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {/* Total Upcoming */}
                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Total Upcoming</p>
                    <p className="text-2xl font-bold text-[#292966] mt-0.5">{stats.totalPending}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-[#CCCCFF]/20 text-[#292966] flex items-center justify-center">
                    <Inbox className="w-5 h-5" />
                  </div>
                </div>

                {/* Due Today */}
                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Due Today</p>
                    <p className="text-2xl font-bold text-rose-600 mt-0.5">{stats.dueTodayCount}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                </div>

                {/* Due Tomorrow */}
                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Due Tomorrow</p>
                    <p className="text-2xl font-bold text-amber-600 mt-0.5">{stats.dueTomorrowCount}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                    <Clock className="w-5 h-5" />
                  </div>
                </div>

                {/* Completed */}
                <div className="p-4 rounded-xl bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">Completed</p>
                    <p className="text-2xl font-bold text-emerald-600 mt-0.5">{stats.completedCount}</p>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                </div>
              </section>

              {/* Assignments Header & Segmented Controls */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold text-[#292966]">Assignments</h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Display all the tasks and essential details.
                    </p>
                  </div>

                  {/* Actions on right */}
                  <div className="flex items-center gap-2.5">
                    {/* Primary Sync Button */}
                    <button
                      type="button"
                      onClick={handleSyncWithTeams}
                      disabled={isRefreshing}
                      className="inline-flex items-center gap-2 bg-[#292966] hover:bg-[#1E1E4F] text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs active:scale-95 transition-all cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#CCCCFF]' : ''}`} />
                      <span>+ Sync Assignments</span>
                    </button>
                  </div>
                </div>

                {/* Clean inline segmented control: [ All (20) | Active (X) | Completed (20) ] */}
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-3 flex-wrap gap-3">
                  <div className="inline-flex p-1 rounded-lg bg-slate-100/90 border border-slate-200/60 text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setSegmentFilter('all')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                        segmentFilter === 'all'
                          ? 'bg-white text-[#292966] font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-[#292966]'
                      }`}
                    >
                      All ({tasks.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSegmentFilter('active')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                        segmentFilter === 'active'
                          ? 'bg-white text-[#292966] font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-[#292966]'
                      }`}
                    >
                      Active ({stats.totalPending})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSegmentFilter('completed')}
                      className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                        segmentFilter === 'completed'
                          ? 'bg-white text-[#292966] font-bold shadow-2xs'
                          : 'text-slate-600 hover:text-[#292966]'
                      }`}
                    >
                      Completed ({stats.completedCount})
                    </button>
                  </div>

                  {/* Filter & Sort Controls */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Filter by Course Dropdown */}
                    <div className="relative" ref={filterMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={`inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border text-xs font-medium px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer ${
                          selectedCourse !== 'all'
                            ? 'border-[#292966] text-[#292966] bg-[#CCCCFF]/15'
                            : 'border-slate-200'
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5 text-[#5C5C99]" />
                        <span>Filter by Course</span>
                        {selectedCourse !== 'all' && (
                          <span className="w-2 h-2 rounded-full bg-[#292966]" />
                        )}
                      </button>

                      {showFilterDropdown && (
                        <div className="absolute right-0 mt-2 w-72 rounded-xl bg-white border border-slate-200/90 shadow-xl p-2 z-30 text-xs flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100">
                          <div className="px-3 py-1.5 border-b border-slate-100 font-semibold text-[#292966] text-xs">
                            Filter by Course
                          </div>
                          <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCourse('all');
                                setShowFilterDropdown(false);
                              }}
                              className={`w-full text-left py-2 px-3 leading-normal text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                selectedCourse === 'all'
                                  ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                  : 'text-slate-700 hover:bg-[#CCCCFF]/20 hover:text-[#292966]'
                              }`}
                            >
                              All Courses ({tasks.length})
                            </button>
                            {courses.map((course) => (
                              <button
                                key={course.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCourse(course.id);
                                  setShowFilterDropdown(false);
                                }}
                                className={`w-full text-left py-2 px-3 leading-normal text-xs font-medium rounded-md transition-colors cursor-pointer ${
                                  selectedCourse === course.id
                                    ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                    : 'text-slate-700 hover:bg-[#CCCCFF]/20 hover:text-[#292966]'
                                }`}
                              >
                                <span className="font-semibold text-[#292966]">[{course.code}]</span>{' '}
                                <span className="text-slate-600">{course.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative" ref={sortMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowSortDropdown(!showSortDropdown)}
                        className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                        <span>Sort</span>
                      </button>

                      {showSortDropdown && (
                        <div className="absolute right-0 mt-1 w-48 rounded-xl bg-white border border-slate-200 shadow-xl p-1.5 z-30 text-xs flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={() => {
                              setSortOption('deadline_asc');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-3 py-1.5 rounded-md ${
                              sortOption === 'deadline_asc'
                                ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            Nearest Deadline
                          </button>
                          <button
                            onClick={() => {
                              setSortOption('deadline_desc');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-3 py-1.5 rounded-md ${
                              sortOption === 'deadline_desc'
                                ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            Furthest Deadline
                          </button>
                          <button
                            onClick={() => {
                              setSortOption('priority');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-3 py-1.5 rounded-md ${
                              sortOption === 'priority'
                                ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            Priority (Urgent first)
                          </button>
                          <button
                            onClick={() => {
                              setSortOption('title_asc');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-3 py-1.5 rounded-md ${
                              sortOption === 'title_asc'
                                ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            Title (A - Z)
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Export .ICS Button */}
                    <button
                      type="button"
                      onClick={handleExportICS}
                      className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                      title="Export active tasks to .ICS"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      <span>Export .ICS</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Error Notification */}
              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                  <button
                    onClick={() => fetchTasks(userId)}
                    className="underline font-semibold hover:text-rose-900"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Table Data Card */}
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)]">
                  <RefreshCw className="w-6 h-6 text-[#292966] animate-spin" />
                  <p className="text-xs text-slate-500 font-medium">Loading assignments...</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden flex flex-col">
                  {/* Responsive Table Wrapper */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-[#F8F9FC] text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          <th className="py-3 px-3.5 w-10 text-center">
                            <span className="sr-only">Check</span>
                          </th>
                          <th className="py-3 px-3.5">TASK</th>
                          <th className="py-3 px-3.5 w-44">COURSE</th>
                          <th className="py-3 px-3.5 w-40">DUE DATE</th>
                          <th className="py-3 px-3.5 w-32">URGENCY</th>
                          <th className="py-3 px-3.5 w-28 text-right">ACTION</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedTasks.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-16 text-center text-xs text-slate-500">
                              <div className="flex flex-col items-center gap-1.5">
                                <p className="font-semibold text-sm text-[#292966]">No assignments found</p>
                                <p className="text-xs text-slate-400 max-w-sm">
                                  {searchQuery || selectedCourse !== 'all'
                                    ? 'No tasks match your active search or filters.'
                                    : 'Scan your MS Teams course channels with the Hark extension to ingest assignments.'}
                                </p>
                                {(searchQuery || selectedCourse !== 'all') && (
                                  <button
                                    onClick={() => {
                                      setSearchQuery('');
                                      setSelectedCourse('all');
                                    }}
                                    className="mt-2 text-xs font-semibold text-[#292966] underline cursor-pointer"
                                  >
                                    Clear all filters
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          paginatedTasks.map((task) => (
                            <TaskTableRow
                              key={task.id}
                              task={task}
                              onToggleStatus={handleToggleTaskStatus}
                            />
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Table Pagination / Footer */}
                  <div className="px-4 py-3 border-t border-slate-100 bg-[#F8F9FC] flex items-center justify-between text-xs text-slate-500">
                    <div>
                      <span>
                        Showing{' '}
                        <strong className="text-[#292966]">
                          {filteredTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                        </strong>{' '}
                        to{' '}
                        <strong className="text-[#292966]">
                          {Math.min(currentPage * pageSize, filteredTasks.length)}
                        </strong>{' '}
                        of <strong className="text-[#292966]">{filteredTasks.length}</strong> tasks &bull;{' '}
                        Page {currentPage} of {totalPages}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs cursor-pointer"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: COURSES / TEAMS VIEW */}
          {activeMainTab === 'courses' && (
            <div className="flex flex-col gap-6">
              {/* Courses Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-[#292966]">Courses &amp; Teams</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enrolled academic channels and connected Microsoft Teams courses.
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleSyncWithTeams}
                    disabled={isRefreshing}
                    className="inline-flex items-center gap-2 bg-[#292966] hover:bg-[#1E1E4F] text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs active:scale-95 transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#CCCCFF]' : ''}`} />
                    <span>Sync Channels</span>
                  </button>
                </div>
              </div>

              {/* Courses Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses.length === 0 ? (
                  <div className="col-span-full py-16 text-center bg-white rounded-xl border border-slate-200/80 p-6 text-xs text-slate-500">
                    <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="font-semibold text-sm text-[#292966]">No courses discovered yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                      Scan your MS Teams channels with the Hark extension to automatically import all your enrolled classes.
                    </p>
                  </div>
                ) : (
                  courses.map((course) => {
                    const taskCount = tasks.filter((t) => t.course_id === course.id).length;
                    const initial = course.code ? course.code.charAt(0).toUpperCase() : 'C';

                    return (
                      <div
                        key={course.id}
                        className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex flex-col justify-between hover:border-[#CCCCFF] transition-all group"
                      >
                        <div className="flex flex-col gap-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="w-10 h-10 rounded-lg bg-[#CCCCFF]/30 text-[#292966] font-bold text-sm flex items-center justify-center flex-shrink-0">
                              {initial}
                            </div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#CCCCFF]/25 text-[#292966]">
                              {taskCount} assignment{taskCount === 1 ? '' : 's'}
                            </span>
                          </div>

                          <div>
                            <span className="text-xs font-bold font-mono text-[#5C5C99] uppercase tracking-wide">
                              {course.code}
                            </span>
                            <h3 className="text-sm font-semibold text-[#292966] leading-snug mt-0.5">
                              {course.name}
                            </h3>
                          </div>

                          {course.channel_id && (
                            <p className="text-[11px] text-slate-400 line-clamp-1 truncate">
                              Channel: {course.channel_id}
                            </p>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCourse(course.id);
                              setActiveMainTab('assignments');
                            }}
                            className="text-xs font-semibold text-[#292966] hover:underline cursor-pointer"
                          >
                            View Assignments &rarr;
                          </button>

                          <a
                            href="https://teams.microsoft.com/v2/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-400 hover:text-[#292966] transition-colors"
                            title="Open in Teams"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Settings / Account Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6 text-slate-800 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-[#292966]" />
                <h2 className="text-base font-bold text-[#292966]">Settings &amp; Pairing</h2>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-[#292966] hover:bg-slate-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  Active Student User ID (UUID)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputUserId}
                    onChange={(e) => setInputUserId(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-[#292966]"
                    placeholder="Enter UUID..."
                  />
                  <button
                    onClick={handleSaveUserId}
                    className="px-3 py-2 bg-[#292966] hover:bg-[#1E1E4F] text-white rounded-lg font-semibold transition-colors cursor-pointer"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Default sample user: <code className="text-[#292966]">{DEFAULT_USER_ID}</code>
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col gap-2">
                <span className="font-bold text-[#292966]">Companion Extension Status</span>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Connection</span>
                  <span
                    className={`font-semibold ${
                      extensionState.isInstalled ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    {extensionState.isInstalled ? 'Installed & Synced' : 'Not Connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Version</span>
                  <span className="font-mono text-slate-700">
                    {extensionState.version || 'v1.0.0 (unpacked)'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
