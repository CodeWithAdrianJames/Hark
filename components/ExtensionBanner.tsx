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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-200">
        <div className="relative w-full max-w-lg rounded-2xl bg-white border border-[#E5E7EB] shadow-2xl p-6 text-[#292966] flex flex-col gap-5">
          {/* Close button */}
          <button
            onClick={() => setShowModal(false)}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-[#5C5C99] hover:text-[#292966] hover:bg-[#F8F9FD] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Modal Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#CCCCFF]/30 border border-[#CCCCFF] flex items-center justify-center text-[#292966]">
              <ChromeIcon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#292966]">
                Load Hark Companion in Chrome
              </h3>
              <p className="text-xs text-[#5C5C99]">
                Fast, zero-config local developer installation (1 minute)
              </p>
            </div>
          </div>

          {/* Steps List */}
          <div className="flex flex-col gap-3 text-xs text-[#292966]">
            {/* Step 1 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#F8F9FD] border border-[#E5E7EB]">
              <span className="w-5 h-5 rounded-full bg-[#292966] text-white font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-[#292966]">Open Chrome Extensions</p>
                <p className="text-[#5C5C99] mt-0.5">
                  Navigate to{' '}
                  <code className="px-1.5 py-0.5 rounded bg-[#CCCCFF]/30 text-[#292966] font-mono text-[11px]">
                    chrome://extensions
                  </code>{' '}
                  in your browser address bar and enable{' '}
                  <span className="text-[#292966] font-medium">Developer mode</span> in the top right.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#F8F9FD] border border-[#E5E7EB]">
              <span className="w-5 h-5 rounded-full bg-[#292966] text-white font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-[#292966]">Click &quot;Load unpacked&quot;</p>
                <p className="text-[#5C5C99] mt-0.5">
                  Select the <code className="text-[#292966] font-semibold">extension/</code> directory from this project workspace.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('extension');
                      setCopiedPath(true);
                      setTimeout(() => setCopiedPath(false), 2000);
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-[#CCCCFF] text-[11px] text-[#292966] hover:bg-[#CCCCFF]/20 transition-colors shadow-2xs"
                  >
                    {copiedPath ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>Copy folder name</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3 items-start p-3 rounded-xl bg-[#F8F9FD] border border-[#E5E7EB]">
              <span className="w-5 h-5 rounded-full bg-[#292966] text-white font-bold flex items-center justify-center flex-shrink-0 text-[11px]">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-[#292966]">Copy Extension ID & Verify</p>
                <p className="text-[#5C5C99] mt-0.5">
                  Paste the 32-character ID from your extensions page to pair automatically:
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={customIdInput}
                    onChange={(e) => setCustomIdInput(e.target.value)}
                    placeholder="e.g. jfnd... (32 lowercase characters)"
                    className="flex-1 bg-white border border-[#CCCCFF] rounded-lg px-2.5 py-1.5 text-xs text-[#292966] placeholder:text-[#A3A3CC] outline-none focus:border-[#292966] font-mono"
                  />
                  <button
                    onClick={handleTestConnection}
                    disabled={isVerifying}
                    className="px-3 py-1.5 bg-[#292966] hover:bg-[#1F1F4D] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
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
          <div className="flex items-center justify-between pt-2 border-t border-[#E5E7EB] text-xs">
            <span className="text-[#5C5C99]">
              Active Dashboard User: <code className="text-[#292966] font-mono">{activeUserId.slice(0, 8)}...</code>
            </span>
            <button
              onClick={() => setShowModal(false)}
              className="px-3 py-1.5 text-[#5C5C99] hover:text-[#292966] text-xs font-medium"
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
      <section className="relative overflow-hidden rounded-xl bg-white border border-[#CCCCFF] p-4 sm:p-5 shadow-sm">
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Icon & Copy */}
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#CCCCFF]/40 border border-[#CCCCFF] flex items-center justify-center text-[#292966] shadow-2xs flex-shrink-0">
              <ChromeIcon className="w-5 h-5" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#292966] tracking-tight">
                  Sync MS Teams Directly to Hark
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#CCCCFF]/40 text-[#292966] border border-[#CCCCFF]">
                  Chrome Extension
                </span>
              </div>
              <p className="text-xs text-[#5C5C99] mt-0.5 max-w-2xl leading-relaxed">
                Install the browser companion to automatically ingest upcoming assignments, announcements, and Teams deep links.
              </p>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2.5 sm:self-center self-end">
            <button
              onClick={handleOpenInstall}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#292966] hover:bg-[#1F1F4D] text-white text-xs font-semibold shadow-xs transition-all active:scale-95"
            >
              <ChromeIcon className="w-4 h-4" />
              <span>Add to Chrome (Free)</span>
            </button>

            <button
              onClick={handleDismiss}
              title="Dismiss banner"
              className="p-2 rounded-lg hover:bg-[#F8F9FD] text-[#5C5C99] hover:text-[#292966] transition-colors"
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
    triggerAutoSync,
  } = extensionState;

  if (isChecking) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#F8F9FD] border border-[#E5E7EB] text-[11px] text-[#5C5C99]">
        <RefreshCw className="w-3 h-3 animate-spin text-[#292966]" />
        <span className="hidden sm:inline">Checking Extension...</span>
      </div>
    );
  }

  // 1. Live Fetching State
  if (isInstalled && syncStatus === 'FETCHING') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 shadow-xs animate-pulse">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
        <span className="font-semibold tracking-tight">
          Syncing assignments from Teams...
        </span>
      </div>
    );
  }

  // 2. Live Success State
  if (isInstalled && syncStatus === 'SUCCESS') {
    return (
      <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 shadow-xs">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
        <span className="font-semibold tracking-tight">
          ✓ Synced {syncedCount} assignment{syncedCount === 1 ? '' : 's'}
        </span>
      </div>
    );
  }

  // 3. Teams Not Open State
  if (isInstalled && syncStatus === 'NO_TEAMS') {
    return (
      <button
        onClick={() => triggerAutoSync()}
        title="Open MS Teams and click to sync"
        className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-white hover:bg-[#F8F9FD] border border-[#E5E7EB] text-[11px] text-[#5C5C99] hover:text-[#292966] transition-all"
      >
        <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
        <span className="font-medium tracking-tight">
          Teams not open
        </span>
      </button>
    );
  }

  // 4. Default Idle Installed & Synced State
  if (isInstalled) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 shadow-2xs"
        title={`Hark Extension v${version || '1.0.0'} connected.`}
      >
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="font-medium tracking-tight">
          Connected
        </span>
        <button
          onClick={() => triggerAutoSync()}
          title="Re-sync assignments now"
          className="p-0.5 hover:bg-emerald-100 rounded text-emerald-700 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onOpenSetup}
      className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#CCCCFF]/30 hover:bg-[#CCCCFF]/60 border border-[#CCCCFF] text-[11px] text-[#292966] font-medium transition-colors"
      title="Pair Hark Chrome Companion Extension"
    >
      <ChromeIcon className="w-3.5 h-3.5 text-[#292966]" />
      <span>Pair Extension</span>
    </button>
  );
};
