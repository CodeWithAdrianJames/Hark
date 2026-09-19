'use client';

import React from 'react';
import {
  Sparkles,
  CheckSquare,
  BookOpen,
  RefreshCw,
  Settings,
  X,
  ChevronsUpDown,
} from 'lucide-react';
import { HarkExtensionState } from '@/hooks/useHarkExtension';

export interface SidebarProps {
  activeMainTab: 'assignments' | 'courses';
  onSelectMainTab: (tab: 'assignments' | 'courses') => void;
  upcomingCount: number;
  pastDueCount: number;
  coursesCount: number;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  extensionState: HarkExtensionState;
  userId: string;
  onOpenSettings: () => void;
  onSync: () => void;
  isRefreshing: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeMainTab,
  onSelectMainTab,
  upcomingCount,
  pastDueCount,
  coursesCount,
  sidebarOpen,
  onCloseSidebar,
  extensionState,
  userId,
  onOpenSettings,
  onSync,
  isRefreshing,
}) => {
  return (
    <>
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden backdrop-blur-xs animate-in fade-in duration-150"
          onClick={onCloseSidebar}
        />
      )}

      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-64 bg-white border-r border-slate-200/70 flex flex-col justify-between transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
      <div className="flex flex-col h-full">
        {/* Brand Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#292966] flex items-center justify-center text-white shadow-2xs">
              <Sparkles className="w-3.5 h-3.5 text-[#CCCCFF]" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-[#292966] tracking-tight leading-none">
                Hark
              </span>
              <span className="text-[10px] font-semibold text-[#5C5C99] tracking-wider uppercase mt-0.5">
                Academic Hub
              </span>
            </div>
          </div>
          <button
            onClick={onCloseSidebar}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace Selector Pill */}
        <div className="px-3.5 py-3">
          <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-slate-50/80 border border-slate-200/70 hover:border-[#A3A3CC] transition-colors cursor-pointer group shadow-2xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-5 h-5 rounded-md bg-[#CCCCFF]/40 text-[#292966] font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                C
              </div>
              <div className="flex flex-col truncate">
                <span className="text-xs font-semibold text-slate-800 truncate">
                  CIT - University
                </span>
                <span className="text-[10px] text-slate-400">Student Workspace</span>
              </div>
            </div>
            <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 flex-shrink-0 transition-colors" />
          </div>
        </div>

        {/* Navigation Group: Strictly TWO main views */}
        <nav className="flex-1 px-3 py-1 space-y-1 overflow-y-auto">
          {/* 1. Assignments */}
          <button
            type="button"
            onClick={() => {
              onSelectMainTab('assignments');
              onCloseSidebar();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeMainTab === 'assignments'
                ? 'bg-[#CCCCFF]/20 text-[#292966] font-semibold shadow-2xs border-l-2 border-[#292966]'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <CheckSquare
                className={`w-4 h-4 ${
                  activeMainTab === 'assignments' ? 'text-[#292966]' : 'text-slate-400'
                }`}
              />
              <span>Assignments</span>
            </div>
            <div className="flex items-center gap-1 font-mono">
              {pastDueCount > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/60"
                  title={`${pastDueCount} past due`}
                >
                  {pastDueCount}
                </span>
              )}
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-[#CCCCFF]/30 text-[#292966]">
                {upcomingCount}
              </span>
            </div>
          </button>

          {/* 2. Courses / Teams */}
          <button
            type="button"
            onClick={() => {
              onSelectMainTab('courses');
              onCloseSidebar();
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeMainTab === 'courses'
                ? 'bg-[#CCCCFF]/20 text-[#292966] font-semibold shadow-2xs border-l-2 border-[#292966]'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BookOpen
                className={`w-4 h-4 ${
                  activeMainTab === 'courses' ? 'text-[#292966]' : 'text-slate-400'
                }`}
              />
              <span>Courses / Teams</span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              {coursesCount}
            </span>
          </button>
        </nav>

        {/* Bottom Section: Extension Sync Status Card */}
        <div className="p-3 border-t border-slate-100">
          <div className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-200/70 flex flex-col gap-2 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    extensionState.isInstalled ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}
                />
                <span className="text-xs font-semibold text-slate-800">
                  {extensionState.isInstalled
                    ? 'Extension Active'
                    : 'Pair Extension'}
                </span>
              </div>
              <button
                type="button"
                onClick={onSync}
                disabled={isRefreshing}
                title="Re-sync assignments from MS Teams"
                className="p-1 rounded-md hover:bg-white text-slate-400 hover:text-[#292966] transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isRefreshing ? 'animate-spin text-[#292966]' : ''
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>{extensionState.isInstalled ? 'Teams live bridge' : 'Not paired'}</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {extensionState.isInstalled
                  ? `v${extensionState.version || '1.0'}`
                  : 'Pair now'}
              </span>
            </div>

            {!extensionState.isInstalled && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-1 w-full py-1 px-2 rounded-md btn-primary-tactile text-white text-xs font-medium text-center cursor-pointer"
              >
                Pair Extension
              </button>
            )}
          </div>

          {/* Student Profile Bar */}
          <div className="mt-2.5 flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-50 transition-colors">
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
              onClick={onOpenSettings}
              title="Account Settings"
              className="p-1 text-slate-400 hover:text-[#292966] transition-colors cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  </>
  );
};

export default Sidebar;
