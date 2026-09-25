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
  ChevronUp,
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
  LayoutList,
  FolderCheck,
} from 'lucide-react';
import { TaskItem } from '@/components/TaskCard';
import { TaskTableRow } from '@/components/TaskTableRow';
import { Sidebar } from '@/components/Sidebar';
import { ExtensionBanner, ExtensionStatusBadge } from '@/components/ExtensionBanner';
import { useHarkExtension } from '@/hooks/useHarkExtension';
import { exportToICS } from '@/lib/dateUtils';
import {
  categorizeTasks,
  LifecycleCategory,
  isTaskCompleted,
  isTaskPastDue,
} from '@/lib/taskUtils';

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

  // Lifecycle Tab State: 'upcoming' | 'past_due' | 'completed' (default: 'upcoming')
  const [lifecycleTab, setLifecycleTab] = useState<LifecycleCategory>('upcoming');
  const [isGroupedView, setIsGroupedView] = useState<boolean>(false);

  // Collapsible Section States for Grouped View
  const [expandedSections, setExpandedSections] = useState<{
    upcoming: boolean;
    past_due: boolean;
    completed: boolean;
  }>({
    upcoming: true,
    past_due: true,
    completed: true,
  });

  // Filter & Search Controls
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  const [sortOption, setSortOption] = useState<'deadline_asc' | 'deadline_desc' | 'title_asc'>('deadline_asc');
  const [showFilterDropdown, setShowFilterDropdown] = useState<boolean>(false);
  const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false);

  // Pagination State (increased default page size to 25 items)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 25;

  // Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const userManuallySelectedTabRef = useRef<boolean>(false);

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
        body: JSON.stringify({ taskId, userId, completed }),
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
    const activeTasks = tasks.filter((t) => !isTaskCompleted(t));
    if (activeTasks.length === 0) {
      alert('No active tasks to export!');
      return;
    }
    exportToICS(activeTasks);
  };

  // Trigger MS Teams auto sync or manual refresh
  const handleSyncWithTeams = () => {
    setIsRefreshing(true);
    if (extensionState.isInstalled) {
      extensionState.triggerAutoSync();
    }
    fetchTasks(userId, true);
  };

  // Categorize raw tasks into 3 distinct lifecycle buckets
  const { upcoming, pastDue, completed } = useMemo(() => {
    return categorizeTasks(tasks);
  }, [tasks]);

  // Metric counts
  const upcomingCount = upcoming.length;
  const pastDueCount = pastDue.length;
  const completedCount = completed.length;

  // Smart Initial Tab Selection: If student has 0 upcoming deadlines but has active past-due deliverables,
  // automatically default to 'past_due' so they aren't greeted with a blank "0 Tasks" screen.
  useEffect(() => {
    if (!userManuallySelectedTabRef.current && tasks.length > 0) {
      if (upcoming.length === 0 && pastDue.length > 0) {
        setLifecycleTab('past_due');
      } else if (upcoming.length > 0) {
        setLifecycleTab('upcoming');
      }
    }
  }, [tasks, upcoming.length, pastDue.length]);

  // User tab selection handler
  const handleSelectLifecycleTab = (tab: LifecycleCategory) => {
    userManuallySelectedTabRef.current = true;
    setLifecycleTab(tab);
    setIsGroupedView(false);
  };

  // Active student enrolled courses: strictly filter out ghost/phantom courses and courses without active/past-due deliverables
  const activeEnrolledCourses = useMemo(() => {
    return courses.filter((course) => {
      if (course.code === 'MAIN' || /main channels|teams and channels/i.test(course.name)) {
        return false;
      }
      const courseTaskCount = tasks.filter(
        (t) =>
          t.course_id === course.id ||
          (t.course_code && t.course_code.toLowerCase() === course.code.toLowerCase())
      ).length;
      return (course.task_count ?? 0) > 0 || courseTaskCount > 0;
    });
  }, [courses, tasks]);

  // Filter & Sort helper for a list of tasks
  const filterAndSortList = useCallback(
    (taskList: TaskItem[]) => {
      const search = searchQuery.trim().toLowerCase();

      const filtered = taskList.filter((task) => {
        // Search filter
        const matchesSearch =
          !search ||
          task.title.toLowerCase().includes(search) ||
          (task.course_code && task.course_code.toLowerCase().includes(search)) ||
          (task.course_name && task.course_name.toLowerCase().includes(search)) ||
          (task.description && task.description.toLowerCase().includes(search));

        // Course filter
        const matchesCourse =
          selectedCourse === 'all' ||
          task.course_id === selectedCourse ||
          (task.course_code && task.course_code.toLowerCase() === selectedCourse.toLowerCase());

        return matchesSearch && matchesCourse;
      });

      // Sort
      filtered.sort((a, b) => {
        if (sortOption === 'title_asc') {
          return a.title.localeCompare(b.title);
        }
        if (sortOption === 'deadline_desc') {
          const timeA = new Date(a.due_date).getTime() || 0;
          const timeB = new Date(b.due_date).getTime() || 0;
          return timeB - timeA;
        }
        // deadline_asc (nearest deadline first)
        const timeA = new Date(a.due_date).getTime() || 0;
        const timeB = new Date(b.due_date).getTime() || 0;
        return timeA - timeB;
      });

      return filtered;
    },
    [searchQuery, selectedCourse, sortOption]
  );

  // Filtered lists for each category
  const filteredUpcoming = useMemo(() => filterAndSortList(upcoming), [upcoming, filterAndSortList]);
  const filteredPastDue = useMemo(() => filterAndSortList(pastDue), [pastDue, filterAndSortList]);
  const filteredCompleted = useMemo(() => filterAndSortList(completed), [completed, filterAndSortList]);

  // Active Category List for Tabbed View
  const activeCategoryList = useMemo(() => {
    switch (lifecycleTab) {
      case 'past_due':
        return filteredPastDue;
      case 'completed':
        return filteredCompleted;
      case 'upcoming':
      default:
        return filteredUpcoming;
    }
  }, [lifecycleTab, filteredUpcoming, filteredPastDue, filteredCompleted]);

  // Reset page when tab or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [lifecycleTab, isGroupedView, searchQuery, selectedCourse, sortOption]);

  // Pagination for Tabbed View
  const totalPages = Math.max(1, Math.ceil(activeCategoryList.length / pageSize));
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return activeCategoryList.slice(start, start + pageSize);
  }, [activeCategoryList, currentPage, pageSize]);

  return (
    <div className="min-h-screen bg-[#FAFAFC] text-slate-800 flex font-sans antialiased selection:bg-[#CCCCFF]/40 selection:text-[#292966]">
      <Sidebar
        activeMainTab={activeMainTab}
        onSelectMainTab={setActiveMainTab}
        upcomingCount={upcomingCount}
        pastDueCount={pastDueCount}
        coursesCount={courses.length}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        extensionState={extensionState}
        userId={userId}
        onOpenSettings={() => setShowSettingsModal(true)}
        onSync={handleSyncWithTeams}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Layout */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 h-14 bg-white/90 backdrop-blur-md border-b border-slate-200/70 px-4 sm:px-8 flex items-center justify-between gap-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {/* Mobile menu trigger + Quick Search */}
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-50 cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Quick Search Bar */}
            <div className="relative w-full max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assignments, courses..."
                className="w-full bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200/80 focus:border-[#5C5C99] rounded-lg pl-8 pr-12 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 outline-none transition-all shadow-2xs"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-mono text-slate-400 shadow-2xs">
                ⌘F
              </kbd>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-2">
            {/* Sync with Teams action button */}
            <button
              type="button"
              onClick={handleSyncWithTeams}
              disabled={isRefreshing}
              className="btn-ghost-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-700 text-xs font-medium cursor-pointer"
              title="Sync assignments from MS Teams"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#5C5C99] ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Sync with Teams</span>
            </button>

            {/* Settings gear icon */}
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              title="Settings & Pairing"
              className="btn-ghost-tactile p-1.5 rounded-lg text-slate-500 hover:text-[#292966] cursor-pointer"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* User Profile Avatar Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowUserModal(!showUserModal)}
                className="btn-ghost-tactile flex items-center gap-1.5 p-1 pl-1.5 pr-2 rounded-full cursor-pointer"
              >
                <div className="w-5 h-5 rounded-full bg-[#292966] text-white font-bold text-[9px] flex items-center justify-center">
                  AJ
                </div>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showUserModal && (
                <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white border border-slate-200/90 shadow-2xl p-3 z-40 text-xs flex flex-col gap-2.5 animate-in fade-in zoom-in-95 duration-100">
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
                        className="p-1 hover:bg-[#CCCCFF]/30 rounded text-slate-400 hover:text-[#292966] cursor-pointer"
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
                    className="w-full py-1.5 rounded-lg btn-ghost-tactile text-slate-700 font-medium text-center cursor-pointer"
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
              {/* High-Craft Connected Metrics Strip */}
              <section className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80">
                  {/* Segment 1: Upcoming Tasks */}
                  <button
                    type="button"
                    onClick={() => handleSelectLifecycleTab('upcoming')}
                    className={`p-4 text-left transition-colors flex items-center justify-between group cursor-pointer ${
                      lifecycleTab === 'upcoming' && !isGroupedView
                        ? 'bg-[#CCCCFF]/15'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-slate-700">
                          Upcoming Tasks
                        </span>
                      </div>
                      <div className="font-mono text-2xl font-bold tracking-tight text-slate-900">
                        {upcomingCount}
                      </div>
                      <p className="text-[11px] text-slate-400">Scheduled active deliverables</p>
                    </div>
                    <div className="flex flex-col items-end">
                      {lifecycleTab === 'upcoming' && !isGroupedView ? (
                        <span className="text-[10px] font-semibold text-[#292966] bg-white px-2 py-0.5 rounded-md border border-slate-200/80 shadow-2xs">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 group-hover:text-[#5C5C99] transition-colors">
                          Filter &rarr;
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Segment 2: Past Due */}
                  <button
                    type="button"
                    onClick={() => handleSelectLifecycleTab('past_due')}
                    className={`p-4 text-left transition-colors flex items-center justify-between group cursor-pointer ${
                      lifecycleTab === 'past_due' && !isGroupedView
                        ? 'bg-rose-50/40'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wider ${
                            pastDueCount > 0 ? 'text-rose-700' : 'text-slate-500'
                          }`}
                        >
                          Past Due
                        </span>
                      </div>
                      <div
                        className={`font-mono text-2xl font-bold tracking-tight ${
                          pastDueCount > 0 ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {pastDueCount}
                      </div>
                      <p
                        className={`text-[11px] ${
                          pastDueCount > 0 ? 'text-rose-600/80 font-medium' : 'text-slate-400'
                        }`}
                      >
                        {pastDueCount > 0 ? 'Requires attention' : 'All deadlines cleared'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end">
                      {lifecycleTab === 'past_due' && !isGroupedView ? (
                        <span className="text-[10px] font-semibold text-rose-700 bg-white px-2 py-0.5 rounded-md border border-rose-200 shadow-2xs">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 group-hover:text-rose-600 transition-colors">
                          Filter &rarr;
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Segment 3: Completed */}
                  <button
                    type="button"
                    onClick={() => handleSelectLifecycleTab('completed')}
                    className={`p-4 text-left transition-colors flex items-center justify-between group cursor-pointer ${
                      lifecycleTab === 'completed' && !isGroupedView
                        ? 'bg-emerald-50/40'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 group-hover:text-emerald-700">
                          Completed
                        </span>
                      </div>
                      <div className="font-mono text-2xl font-bold tracking-tight text-emerald-600">
                        {completedCount}
                      </div>
                      <p className="text-[11px] text-slate-400">Checked off deliverables</p>
                    </div>
                    <div className="flex flex-col items-end">
                      {lifecycleTab === 'completed' && !isGroupedView ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-white px-2 py-0.5 rounded-md border border-emerald-200 shadow-2xs">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 group-hover:text-emerald-600 transition-colors">
                          Filter &rarr;
                        </span>
                      )}
                    </div>
                  </button>
                </div>
              </section>

              {/* Assignments Header & View Controls */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">Assignments</h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Categorized lifecycle tracking: Upcoming, Past Due, and Completed deliverables.
                    </p>
                  </div>

                  {/* Actions on right */}
                  <div className="flex items-center gap-2">
                    {/* Toggle: Segmented Tab View vs Grouped View */}
                    <button
                      type="button"
                      onClick={() => setIsGroupedView(!isGroupedView)}
                      className={`btn-ghost-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                        isGroupedView
                          ? 'bg-slate-100 text-[#292966] font-semibold border-slate-300'
                          : 'text-slate-700'
                      }`}
                      title={isGroupedView ? 'Switch to Segmented Tabs' : 'View all sections grouped vertically'}
                    >
                      <Layers className="w-3.5 h-3.5 text-[#5C5C99]" />
                      <span>{isGroupedView ? 'Grouped View (Active)' : 'Grouped View'}</span>
                    </button>

                    {/* Primary Sync Button */}
                    <button
                      type="button"
                      onClick={handleSyncWithTeams}
                      disabled={isRefreshing}
                      className="btn-primary-tactile inline-flex items-center gap-2 text-white font-semibold text-xs px-3.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#CCCCFF]' : ''}`} />
                      <span>Sync Assignments</span>
                    </button>
                  </div>
                </div>

                {/* 2. Segmented Pill Switcher & Table Bar Controls */}
                <div className="flex items-center justify-between border-b border-slate-200/70 pb-3 flex-wrap gap-3">
                  {!isGroupedView ? (
                    <div className="bg-slate-100/90 p-1 rounded-lg border border-slate-200/60 inline-flex gap-1">
                      {/* Upcoming Tab */}
                      <button
                        type="button"
                        onClick={() => handleSelectLifecycleTab('upcoming')}
                        className={`text-xs py-1 px-3 rounded-md transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                          lifecycleTab === 'upcoming'
                            ? 'bg-white text-[#292966] font-semibold shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>Upcoming</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-[#CCCCFF]/30 text-[#292966]">
                          {upcomingCount}
                        </span>
                      </button>

                      {/* Past Due Tab */}
                      <button
                        type="button"
                        onClick={() => handleSelectLifecycleTab('past_due')}
                        className={`text-xs py-1 px-3 rounded-md transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                          lifecycleTab === 'past_due'
                            ? 'bg-white text-rose-700 font-semibold shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>Past Due</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200/60">
                          {pastDueCount}
                        </span>
                      </button>

                      {/* Completed Tab */}
                      <button
                        type="button"
                        onClick={() => handleSelectLifecycleTab('completed')}
                        className={`text-xs py-1 px-3 rounded-md transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                          lifecycleTab === 'completed'
                            ? 'bg-white text-emerald-700 font-semibold shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <span>Completed</span>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          {completedCount}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#292966]">
                      <LayoutList className="w-4 h-4 text-[#5C5C99]" />
                      <span>Showing All Sections (Upcoming, Past Due, Completed)</span>
                    </div>
                  )}

                  {/* Filter & Sort Controls */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Filter by Course Dropdown */}
                    <div className="relative" ref={filterMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={`btn-ghost-tactile inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer ${
                          selectedCourse !== 'all'
                            ? 'border-[#292966] text-[#292966] bg-[#CCCCFF]/15'
                            : 'text-slate-700'
                        }`}
                      >
                        <Filter className="w-3.5 h-3.5 text-[#5C5C99]" />
                        <span>Filter by Course</span>
                        {selectedCourse !== 'all' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#292966]" />
                        )}
                      </button>

                      {showFilterDropdown && (
                        <div className="absolute right-0 mt-1 w-72 rounded-xl bg-white border border-slate-200/90 shadow-2xl p-2 z-30 text-xs flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <div className="px-2.5 py-1.5 border-b border-slate-100 font-semibold text-slate-800 text-[11px] uppercase tracking-wider">
                            Filter by Course
                          </div>
                          <div className="max-h-60 overflow-y-auto flex flex-col gap-0.5 mt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCourse('all');
                                setShowFilterDropdown(false);
                              }}
                              className={`w-full text-left py-1.5 px-2.5 rounded-md transition-colors cursor-pointer text-xs font-medium ${
                                selectedCourse === 'all'
                                  ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                  : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              All Courses ({tasks.length})
                            </button>
                            {activeEnrolledCourses.map((course) => {
                              const taskCount = tasks.filter(
                                (t) =>
                                  t.course_id === course.id ||
                                  (t.course_code && t.course_code.toLowerCase() === course.code.toLowerCase())
                              ).length;
                              return (
                                <button
                                  key={course.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCourse(course.id);
                                    setShowFilterDropdown(false);
                                  }}
                                  className={`w-full text-left py-1.5 px-2.5 rounded-md transition-colors cursor-pointer flex items-center justify-between text-xs font-medium ${
                                    selectedCourse === course.id
                                      ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                      : 'text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="truncate">
                                    <span className="font-mono font-semibold text-[#5C5C99]">[{course.code}]</span>{' '}
                                    <span className="text-slate-700">{course.name}</span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono ml-2">({taskCount})</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Sort Dropdown */}
                    <div className="relative" ref={sortMenuRef}>
                      <button
                        type="button"
                        onClick={() => setShowSortDropdown(!showSortDropdown)}
                        className="btn-ghost-tactile inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer text-slate-700"
                      >
                        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                        <span>Sort</span>
                      </button>

                      {showSortDropdown && (
                        <div className="absolute right-0 mt-1 w-48 rounded-xl bg-white border border-slate-200/90 shadow-2xl p-1.5 z-30 text-xs flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={() => {
                              setSortOption('deadline_asc');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
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
                            className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                              sortOption === 'deadline_desc'
                                ? 'bg-[#CCCCFF]/30 text-[#292966] font-semibold'
                                : 'hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            Furthest Deadline
                          </button>
                          <button
                            onClick={() => {
                              setSortOption('title_asc');
                              setShowSortDropdown(false);
                            }}
                            className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
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
                      className="btn-ghost-tactile inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg cursor-pointer text-slate-700"
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
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between shadow-2xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                  <button
                    onClick={() => fetchTasks(userId)}
                    className="underline font-semibold hover:text-rose-900 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Loading State: Clean SaaS Table Skeleton */}
              {isLoading ? (
                <div className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden">
                  <div className="h-9 bg-slate-50/80 border-b border-slate-200/80 px-3.5 flex items-center justify-between">
                    <div className="h-3 w-28 bg-slate-200 rounded animate-pulse" />
                    <div className="h-3 w-16 bg-slate-200 rounded animate-pulse" />
                  </div>
                  <div className="divide-y divide-slate-100">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div
                        key={i}
                        className="h-12 flex items-center justify-between px-3.5 animate-pulse"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded-[4px] bg-slate-200" />
                          <div className="flex flex-col gap-1.5">
                            <div className="h-3 w-48 sm:w-64 bg-slate-200 rounded" />
                            <div className="h-2 w-32 bg-slate-100 rounded" />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="h-5 w-24 bg-slate-100 rounded" />
                          <div className="h-3 w-20 bg-slate-200 rounded" />
                          <div className="h-5 w-16 bg-slate-100 rounded-full" />
                          <div className="h-6 w-14 bg-slate-200 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : isGroupedView ? (
                /* GROUPED VIEW: Vertically stacked sections with collapsible headers */
                <div className="flex flex-col gap-5">
                  {/* Section 1: Upcoming */}
                  <div className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSections((prev) => ({ ...prev, upcoming: !prev.upcoming }))
                      }
                      className="w-full px-4 py-3 bg-slate-50/70 hover:bg-slate-100/70 border-b border-slate-200/70 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Upcoming Assignments
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-[#CCCCFF]/30 text-[#292966]">
                          {filteredUpcoming.length}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        {expandedSections.upcoming ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {expandedSections.upcoming && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="h-9 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur-sm text-[11px] font-semibold text-[#5C5C99] uppercase tracking-wider">
                              <th className="py-2 px-3.5 w-10 text-center">
                                <span className="sr-only">Check</span>
                              </th>
                              <th className="py-2 px-3.5">TASK</th>
                              <th className="py-2 px-3.5 w-44">COURSE</th>
                              <th className="py-2 px-3.5 w-40">DUE DATE</th>
                              <th className="py-2 px-3.5 w-32">STATUS</th>
                              <th className="py-2 px-3.5 w-28 text-right">ACTIONS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredUpcoming.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                                  No upcoming assignments — you are all set for now!
                                </td>
                              </tr>
                            ) : (
                              filteredUpcoming.map((task) => (
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
                    )}
                  </div>

                  {/* Section 2: Past Due */}
                  <div className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSections((prev) => ({ ...prev, past_due: !prev.past_due }))
                      }
                      className="w-full px-4 py-3 bg-rose-50/40 hover:bg-rose-50/70 border-b border-rose-100/80 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-rose-500" />
                        <h3 className="text-xs font-bold text-rose-800 uppercase tracking-wider">
                          Past Due Assignments
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-rose-50 text-rose-700 border border-rose-200/60">
                          {filteredPastDue.length}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        {expandedSections.past_due ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {expandedSections.past_due && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="h-9 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur-sm text-[11px] font-semibold text-[#5C5C99] uppercase tracking-wider">
                              <th className="py-2 px-3.5 w-10 text-center">
                                <span className="sr-only">Check</span>
                              </th>
                              <th className="py-2 px-3.5">TASK</th>
                              <th className="py-2 px-3.5 w-44">COURSE</th>
                              <th className="py-2 px-3.5 w-40">DUE DATE</th>
                              <th className="py-2 px-3.5 w-32">STATUS</th>
                              <th className="py-2 px-3.5 w-28 text-right">ACTIONS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredPastDue.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                                  No past due assignments — all cleared!
                                </td>
                              </tr>
                            ) : (
                              filteredPastDue.map((task) => (
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
                    )}
                  </div>

                  {/* Section 3: Completed */}
                  <div className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSections((prev) => ({ ...prev, completed: !prev.completed }))
                      }
                      className="w-full px-4 py-3 bg-emerald-50/40 hover:bg-emerald-50/70 border-b border-emerald-100/70 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                          Completed Deliverables
                        </h3>
                        <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                          {filteredCompleted.length}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        {expandedSections.completed ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {expandedSections.completed && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="h-9 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur-sm text-[11px] font-semibold text-[#5C5C99] uppercase tracking-wider">
                              <th className="py-2 px-3.5 w-10 text-center">
                                <span className="sr-only">Check</span>
                              </th>
                              <th className="py-2 px-3.5">TASK</th>
                              <th className="py-2 px-3.5 w-44">COURSE</th>
                              <th className="py-2 px-3.5 w-40">DUE DATE</th>
                              <th className="py-2 px-3.5 w-32">STATUS</th>
                              <th className="py-2 px-3.5 w-28 text-right">ACTIONS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredCompleted.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-8 text-center text-xs text-slate-400">
                                  No completed assignments yet. Check off items as you finish them!
                                </td>
                              </tr>
                            ) : (
                              filteredCompleted.map((task) => (
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
                    )}
                  </div>
                </div>
              ) : (
                /* TABBED VIEW: High-Density Table with Category Empty States & Pagination */
                <div className="bg-white rounded-xl border border-slate-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] overflow-hidden flex flex-col">
                  {/* Responsive Table Wrapper */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="h-9 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur-sm text-[11px] font-semibold text-[#5C5C99] uppercase tracking-wider">
                          <th className="py-2 px-3.5 w-10 text-center">
                            <span className="sr-only">Check</span>
                          </th>
                          <th className="py-2 px-3.5">TASK</th>
                          <th className="py-2 px-3.5 w-44">COURSE</th>
                          <th className="py-2 px-3.5 w-40">DUE DATE</th>
                          <th className="py-2 px-3.5 w-32">STATUS</th>
                          <th className="py-2 px-3.5 w-28 text-right">ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {paginatedTasks.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-16 text-center text-xs text-slate-500">
                              <div className="flex flex-col items-center gap-2 py-4">
                                {searchQuery || selectedCourse !== 'all' ? (
                                  <>
                                    <p className="font-semibold text-sm text-slate-900">
                                      No assignments found matching filters
                                    </p>
                                    <p className="text-xs text-slate-400 max-w-sm">
                                      Try clearing your search query or selecting &quot;All Courses&quot;.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSearchQuery('');
                                        setSelectedCourse('all');
                                      }}
                                      className="mt-2 text-xs font-semibold text-[#292966] underline cursor-pointer"
                                    >
                                      Clear all filters
                                    </button>
                                  </>
                                ) : lifecycleTab === 'upcoming' ? (
                                  <>
                                    <p className="font-semibold text-sm text-slate-900">
                                      No upcoming assignments found
                                    </p>
                                    {pastDueCount > 0 ? (
                                      <>
                                        <p className="text-xs text-slate-500 max-w-md text-center leading-relaxed">
                                          You currently have{' '}
                                          <strong className="text-rose-600 font-semibold font-mono">
                                            {pastDueCount} past-due assignment{pastDueCount > 1 ? 's' : ''}
                                          </strong>{' '}
                                          that require your attention.
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleSelectLifecycleTab('past_due')}
                                          className="mt-2 btn-ghost-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-rose-700 text-xs font-semibold border-rose-200 hover:bg-rose-50 cursor-pointer"
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                                          <span>View Past Due Assignments ({pastDueCount})</span>
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <p className="text-xs text-slate-400 max-w-sm text-center">
                                          You are completely caught up! Scan your MS Teams course channels to capture newly posted deliverables.
                                        </p>
                                        <button
                                          type="button"
                                          onClick={handleSyncWithTeams}
                                          disabled={isRefreshing}
                                          className="mt-2 btn-primary-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-white text-xs font-medium cursor-pointer"
                                        >
                                          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                                          <span>Sync with Teams</span>
                                        </button>
                                      </>
                                    )}
                                  </>
                                ) : lifecycleTab === 'past_due' ? (
                                  <>
                                    <p className="font-semibold text-sm text-slate-900">
                                      No past-due assignments — all clear!
                                    </p>
                                    {upcomingCount > 0 ? (
                                      <>
                                        <p className="text-xs text-slate-500 max-w-sm text-center">
                                          All past deliverables are cleared. You have{' '}
                                          <strong className="text-slate-900 font-semibold font-mono">{upcomingCount}</strong> upcoming task{upcomingCount > 1 ? 's' : ''}.
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleSelectLifecycleTab('upcoming')}
                                          className="mt-2 btn-ghost-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[#292966] text-xs font-semibold cursor-pointer"
                                        >
                                          <Clock className="w-3.5 h-3.5 text-[#5C5C99]" />
                                          <span>View Upcoming ({upcomingCount})</span>
                                        </button>
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-400 max-w-sm text-center">
                                        All your assignments are on track and within deadline.
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <p className="font-semibold text-sm text-slate-900">
                                      No completed assignments yet
                                    </p>
                                    <p className="text-xs text-slate-400 max-w-sm text-center">
                                      Check off tasks in Upcoming or Past Due as you submit them to track your progress.
                                    </p>
                                    {upcomingCount + pastDueCount > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => handleSelectLifecycleTab(upcomingCount > 0 ? 'upcoming' : 'past_due')}
                                        className="mt-2 btn-ghost-tactile inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[#292966] text-xs font-semibold cursor-pointer"
                                      >
                                        <span>View Active Tasks ({upcomingCount + pastDueCount})</span>
                                      </button>
                                    )}
                                  </>
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
                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
                    <div>
                      <span>
                        Showing{' '}
                        <strong className="text-slate-800 font-mono">
                          {activeCategoryList.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                        </strong>{' '}
                        to{' '}
                        <strong className="text-slate-800 font-mono">
                          {Math.min(currentPage * pageSize, activeCategoryList.length)}
                        </strong>{' '}
                        of <strong className="text-slate-800 font-mono">{activeCategoryList.length}</strong>{' '}
                        {lifecycleTab === 'past_due'
                          ? 'past due'
                          : lifecycleTab === 'completed'
                          ? 'completed'
                          : 'upcoming'}{' '}
                        tasks &bull; Page <span className="font-mono">{currentPage}</span> of <span className="font-mono">{totalPages}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        className="btn-ghost-tactile px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        className="btn-ghost-tactile px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
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
            <div className="flex flex-col gap-5">
              {/* Courses Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">Courses &amp; Teams</h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enrolled academic channels and connected Microsoft Teams courses.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSyncWithTeams}
                    disabled={isRefreshing}
                    className="btn-primary-tactile inline-flex items-center gap-2 text-white font-semibold text-xs px-3.5 py-1.5 rounded-lg cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#CCCCFF]' : ''}`} />
                    <span>Sync Channels</span>
                  </button>
                </div>
              </div>

              {/* Courses Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeEnrolledCourses.length === 0 ? (
                  <div className="col-span-full py-16 text-center bg-white rounded-xl border border-slate-200/70 p-6 text-xs text-slate-500 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)]">
                    <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="font-semibold text-sm text-slate-900">No active enrolled courses discovered yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                      Scan your MS Teams channels with the Hark extension to automatically import all your active enrolled classes.
                    </p>
                  </div>
                ) : (
                  activeEnrolledCourses.map((course) => {
                    const taskCount = tasks.filter(
                      (t) =>
                        t.course_id === course.id ||
                        (t.course_code && t.course_code.toLowerCase() === course.code.toLowerCase())
                    ).length;
                    const initial = course.code ? course.code.charAt(0).toUpperCase() : 'C';

                    return (
                      <div
                        key={course.id}
                        className="bg-white rounded-xl border border-slate-200/70 p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] flex flex-col justify-between hover:border-slate-300 transition-all group"
                      >
                        <div className="flex flex-col gap-2.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="w-8 h-8 rounded-lg bg-[#5C5C99]/15 text-[#292966] font-bold text-xs flex items-center justify-center flex-shrink-0">
                              {initial}
                            </div>
                            <span className="bg-slate-100 text-slate-700 text-[11px] font-medium px-2 py-0.5 rounded border border-slate-200/60 inline-flex items-center font-mono">
                              {taskCount} task{taskCount === 1 ? '' : 's'}
                            </span>
                          </div>

                          <div>
                            <span className="text-[11px] font-bold font-mono text-[#5C5C99] uppercase tracking-wide">
                              {course.code}
                            </span>
                            <h3 className="text-xs font-semibold text-slate-900 leading-snug mt-0.5 group-hover:text-[#292966] transition-colors">
                              {course.name}
                            </h3>
                          </div>

                          {course.channel_id && (
                            <p className="text-[10px] text-slate-400 line-clamp-1 truncate font-mono">
                              Channel: {course.channel_id}
                            </p>
                          )}
                        </div>

                        <div className="mt-3.5 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
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
                            className="btn-ghost-tactile p-1 rounded-md text-slate-400 hover:text-[#292966] cursor-pointer"
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
                <h2 className="text-base font-bold text-slate-900">Settings &amp; Pairing</h2>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 cursor-pointer"
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
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:border-[#5C5C99]"
                    placeholder="Enter UUID..."
                  />
                  <button
                    onClick={handleSaveUserId}
                    className="btn-primary-tactile px-3 py-2 text-white rounded-lg font-semibold cursor-pointer"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Default sample user: <code className="text-[#292966]">{DEFAULT_USER_ID}</code>
                </p>
              </div>

              <div className="p-3 rounded-xl bg-slate-50/80 border border-slate-200/70 flex flex-col gap-2">
                <span className="font-bold text-slate-900">Companion Extension Status</span>
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
                className="btn-ghost-tactile px-4 py-1.5 rounded-lg text-slate-700 text-xs font-medium cursor-pointer"
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
