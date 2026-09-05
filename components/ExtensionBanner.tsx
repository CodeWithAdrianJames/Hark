'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Puzzle,
  X,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  RefreshCw,
  Copy,
  Check,
  Download,
  AlertCircle,
} from 'lucide-react';
import { HarkExtensionState } from '@/hooks/useHarkExtension';

const ChromeIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="4" />
    <line x1="21.17" y1="8" x2="12" y2="8" />
    <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
    <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
  </svg>
);

interface ExtensionBannerProps {
  extensionState: HarkExtensionState;
  activeUserId: string;
}

export const ExtensionBanner: React.FC<ExtensionBannerProps> = ({
  extensionState,
  activeUserId,
}) => {
  const {
    isInstalled,
    isChecking,
    version,
    extensionId,
    setExtensionId,
    pingExtension,
  } = extensionState;

  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [customIdInput, setCustomIdInput] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verificationResult, setVerificationResult] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<boolean>(false);

  // Read dismissal state from sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = sessionStorage.getItem('hark_ext_banner_dismissed');
      if (dismissed === 'true') {
        setIsDismissed(true);
      }
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('hark_ext_banner_dismissed', 'true');
    }
  };

  const handleOpenInstall = () => {
    const webstoreUrl = process.env.NEXT_PUBLIC_CHROME_WEBSTORE_URL;
    if (webstoreUrl && webstoreUrl.startsWith('https://')) {
      window.open(webstoreUrl, '_blank', 'noopener,noreferrer');
    } else {
      setCustomIdInput(extensionId || '');
      setVerificationResult(null);
      setShowModal(true);
    }
  };

  const handleTestConnection = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    const targetId = customIdInput.trim() || extensionId;
    if (!targetId) {
      setVerificationResult('error: Please enter an Extension ID.');
      setIsVerifying(false);
      return;
    }

    setExtensionId(targetId);
    const success = await pingExtension(targetId);
    setIsVerifying(false);

    if (success) {
      setVerificationResult('success: Connected & Synced successfully!');
      setTimeout(() => setShowModal(false), 1400);
    } else {
      setVerificationResult(
        'error: Could not reach extension. Ensure it is loaded in chrome://extensions and Developer mode is ON.'
      );
    }
  };

  // If installed or dismissed, do not render the banner
  if (isInstalled || isDismissed) {
    return (
      <>
        {showModal && renderSetupModal()}
      </>
    );
  }

  function renderSetupModal() {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="relative w-full max-w-lg rounded-2xl bg-[#0b0f19] border border-slate-800 shadow-2xl p-6 text-slate-100 flex flex-col gap-5">
          {/* Close button */}
          <button
            onClick={() => setShowModal(false)}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Modal Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ChromeIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Load Hark Companion in Chrome
              </h3>
              <p className="text-xs text-slate-400">
                Fast, zero-config local developer installation (1 minute)
              </p>
            </div>
          </div>

          {/* Steps List */}
          <div className="flex flex-col gap-3.5 text-xs text-slate-300">
            {/* Step 1 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#0f172a] border border-slate-800/80">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-white">Open Chrome Extensions</p>
                <p className="text-slate-400 mt-0.5">
                  Navigate to{' '}
                  <code className="px-1.5 py-0.5 rounded bg-slate-900 text-indigo-300 font-mono text-[11px]">
                    chrome://extensions
                  </code>{' '}
                  in your browser address bar and enable{' '}
                  <span className="text-white font-medium">Developer mode</span> in the top right.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#0f172a] border border-slate-800/80">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-white">Click &quot;Load unpacked&quot;</p>
                <p className="text-slate-400 mt-0.5">
                  Select the <code className="text-indigo-300">extension/</code> directory from this project workspace.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('extension');
                      setCopiedPath(true);
                      setTimeout(() => setCopiedPath(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300 hover:text-white hover:border-slate-600 transition-colors"
                  >
                    {copiedPath ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy folder name</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#0f172a] border border-slate-800/80">
              <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-white">Copy Extension ID & Verify</p>
                <p className="text-slate-400 mt-0.5">
                  Paste the 32-character ID from your extensions page to pair automatically:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={customIdInput}
                    onChange={(e) => setCustomIdInput(e.target.value)}
                    placeholder="e.g. jfnd... (32 lowercase characters)"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-mono"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={isVerifying}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {isVerifying ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>Verify</span>
                  </button>
                </div>

                {/* Feedback message */}
                {verificationResult && (
                  <div
                    className={`mt-2 p-2 rounded text-xs flex items-center gap-1.5 ${
                      verificationResult.startsWith('success')
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {verificationResult.startsWith('success') ? (
                      <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    )}
                    <span>{verificationResult.replace(/^(success|error):\s*/, '')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-500">
              Active Dashboard User: <code className="text-slate-300 font-mono">{activeUserId.slice(0, 8)}...</code>
            </span>
            <button
              onClick={() => setShowModal(false)}
              className="px-3 py-1.5 text-slate-400 hover:text-white text-xs font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-950/40 via-purple-950/25 to-[#0b0f19] border border-indigo-500/30 p-4 sm:p-5 shadow-lg shadow-indigo-950/30">
        {/* Subtle decorative glow */}
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Icon & Copy */}
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-md shadow-indigo-500/10 flex-shrink-0">
              <ChromeIcon className="w-6 h-6" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                  Sync MS Teams Directly to Hark
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Chrome Extension
                </span>
              </div>
              <p className="text-xs text-slate-300/90 mt-0.5 max-w-2xl leading-relaxed">
                Install the lightweight browser companion to automatically capture your upcoming assignments, announcements, and Teams deep links.
              </p>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2.5 sm:self-center self-end">
            <button
              onClick={handleOpenInstall}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
            >
              <ChromeIcon className="w-4 h-4" />
              <span>Add to Chrome (Free)</span>
            </button>

            <button
              onClick={handleDismiss}
              title="Dismiss onboarding banner"
              className="p-2 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {showModal && renderSetupModal()}
    </>
  );
};

/**
 * ExtensionStatusBadge Component
 * Renders the live status transitions in the top navbar:
 * - "FETCHING": Pulsing amber/blue spinner pill: "⟳ Syncing all assignments from MS Teams..."
 * - "SUCCESS": Green pill: "✓ Synced X upcoming assignments across all classes"
 * - "NO_TEAMS": "● Teams not open (Open Teams to sync)"
 * - "IDLE": "● Extension Active & Synced"
 */
export const ExtensionStatusBadge: React.FC<{
  extensionState: HarkExtensionState;
  onOpenSetup?: () => void;
}> = ({ extensionState, onOpenSetup }) => {
  const {
    isInstalled,
    version,
    isChecking,
    syncStatus,
    syncedCount,
    syncMessage,
    triggerAutoSync,
  } = extensionState;

  if (isChecking) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
        <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
        <span className="hidden sm:inline">Checking Extension...</span>
      </div>
    );
  }

  // 1. Live Fetching State
  if (isInstalled && syncStatus === 'FETCHING') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 shadow-md shadow-amber-950/20 animate-pulse">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
        <span className="font-semibold tracking-tight">
          Syncing all assignments from MS Teams...
        </span>
      </div>
    );
  }

  // 2. Live Success State (Auto-fades after 4s)
  if (isInstalled && syncStatus === 'SUCCESS') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] text-emerald-300 shadow-md shadow-emerald-950/20 animate-in fade-in zoom-in-95 duration-200">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
        <span className="font-semibold tracking-tight">
          ✓ Synced {syncedCount} upcoming assignment{syncedCount === 1 ? '' : 's'} across all classes
        </span>
      </div>
    );
  }

  // 3. Teams Not Open State
  if (isInstalled && syncStatus === 'NO_TEAMS') {
    return (
      <button
        onClick={() => triggerAutoSync()}
        title="MS Teams is not open in any active browser tabs. Open Teams and click to sync."
        className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800/90 border border-slate-700/60 text-[11px] text-slate-300 hover:text-white transition-all active:scale-95"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
        <span className="font-medium tracking-tight">
          Teams not open (Open Teams to sync)
        </span>
      </button>
    );
  }

  // 4. Default Idle Installed & Synced State
  if (isInstalled) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-[11px] text-emerald-400 shadow-xs"
        title={`Hark Extension v${version || '1.0.0'} active. Click sync button to fetch MS Teams assignments.`}
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </span>
        <span className="font-medium tracking-tight">
          Extension Active &amp; Synced
        </span>
        <button
          onClick={() => triggerAutoSync()}
          title="Re-sync assignments across all Teams classes now"
          className="ml-1 p-0.5 hover:bg-emerald-500/20 rounded text-emerald-400 hover:text-emerald-200 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onOpenSetup}
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-indigo-300 transition-colors"
      title="Hark Extension not detected. Click to pair or install."
    >
      <ChromeIcon className="w-3.5 h-3.5 text-indigo-400" />
      <span>Pair Extension</span>
    </button>
  );
};
