'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// Type definition for Chrome runtime messaging
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage: (
          extensionId: string,
          message: unknown,
          responseCallback?: (response: any) => void
        ) => void;
        lastError?: {
          message?: string;
        };
      };
    };
  }
}

export type ExtensionSyncStatus = 'IDLE' | 'FETCHING' | 'SUCCESS' | 'NO_TEAMS' | 'ERROR';

export interface HarkExtensionState {
  isInstalled: boolean;
  isChecking: boolean;
  isPaired: boolean;
  extensionId: string;
  version: string | null;
  error: string | null;
  syncStatus: ExtensionSyncStatus;
  syncedCount: number;
  syncMessage: string | null;
  lastSyncedAt: Date | null;
  pingExtension: (customId?: string) => Promise<boolean>;
  pairUser: (targetUserId: string, customId?: string) => Promise<boolean>;
  triggerAutoSync: (targetExtId?: string) => Promise<{ status: string; count?: number; message?: string }>;
  setExtensionId: (id: string) => void;
}

const STORAGE_KEY_EXT_ID = 'hark_local_extension_id';

export function useHarkExtension(activeUserId?: string): HarkExtensionState {
  const [extensionId, setExtensionIdState] = useState<string>('');
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [isPaired, setIsPaired] = useState<boolean>(false);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live MS Teams Global Sync State
  const [syncStatus, setSyncStatus] = useState<ExtensionSyncStatus>('IDLE');
  const [syncedCount, setSyncedCount] = useState<number>(0);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const hasAutoSyncedRef = useRef<boolean>(false);

  // Initialize extension ID from env or localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const envId = process.env.NEXT_PUBLIC_HARK_EXTENSION_ID?.trim() || '';
    const storedId = localStorage.getItem(STORAGE_KEY_EXT_ID)?.trim() || '';
    const initialId = envId || storedId;

    if (initialId) {
      setExtensionIdState(initialId);
    } else {
      setIsChecking(false);
    }
  }, []);

  // Update extension ID in local state and localStorage
  const setExtensionId = useCallback((newId: string) => {
    const trimmed = newId.trim();
    setExtensionIdState(trimmed);
    if (typeof window !== 'undefined') {
      if (trimmed) {
        localStorage.setItem(STORAGE_KEY_EXT_ID, trimmed);
      } else {
        localStorage.removeItem(STORAGE_KEY_EXT_ID);
      }
    }
  }, []);

  // Pair active user with the extension
  const pairUser = useCallback(
    async (targetUserId: string, targetExtId?: string): Promise<boolean> => {
      const activeExtId = (targetExtId || extensionId).trim();
      if (!activeExtId || typeof window === 'undefined' || !window.chrome?.runtime?.sendMessage) {
        return false;
      }

      const apiEndpoint = `${window.location.origin}/api/ingest`;

      return new Promise<boolean>((resolve) => {
        try {
          window.chrome!.runtime!.sendMessage(
            activeExtId,
            {
              type: 'HARK_SET_USER',
              userId: targetUserId,
              apiEndpoint,
              apiKey: process.env.NEXT_PUBLIC_INGEST_API_KEY || '',
            },
            (response) => {
              if (window.chrome?.runtime?.lastError || !response?.success) {
                console.warn(
                  '[useHarkExtension] Pairing failed or extension not responding:',
                  window.chrome?.runtime?.lastError?.message
                );
                setIsPaired(false);
                resolve(false);
              } else {
                console.log('[useHarkExtension] Successfully paired user:', targetUserId);
                setIsPaired(true);
                setIsInstalled(true);
                if (response.version) setVersion(response.version);
                resolve(true);
              }
            }
          );
        } catch (err: unknown) {
          console.warn('[useHarkExtension] Error dispatching pairing message:', err);
          setIsPaired(false);
          resolve(false);
        }
      });
    },
    [extensionId]
  );

  // Trigger Global MS Teams Assignments Hub Auto-Sync
  const triggerAutoSync = useCallback(
    async (targetExtId?: string): Promise<{ status: string; count?: number; message?: string }> => {
      const activeExtId = (targetExtId || extensionId).trim();

      setSyncStatus('FETCHING');
      setSyncMessage('Syncing all assignments from MS Teams...');

      // 1. Proactively dispatch via window.postMessage bridge (handles dashboard content script)
      if (typeof window !== 'undefined') {
        window.postMessage(
          {
            type: 'HARK_TRIGGER_AUTO_SYNC',
            userId: activeUserId,
            apiEndpoint: `${window.location.origin}/api/ingest`,
            apiKey: process.env.NEXT_PUBLIC_INGEST_API_KEY || '',
          },
          '*'
        );
      }

      // 2. If chrome.runtime.sendMessage is available with an activeExtId, also send directly
      if (activeExtId && typeof window !== 'undefined' && window.chrome?.runtime?.sendMessage) {
        return new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve({ status: 'SUCCESS', message: 'Sync dispatched to extension' });
          }, 8000);

          try {
            const apiEndpoint = `${window.location.origin}/api/ingest`;
            window.chrome!.runtime!.sendMessage(
              activeExtId,
              {
                type: 'HARK_TRIGGER_AUTO_SYNC',
                userId: activeUserId,
                apiEndpoint,
                apiKey: process.env.NEXT_PUBLIC_INGEST_API_KEY || '',
              },
              (response) => {
                clearTimeout(timeoutId);
                if (window.chrome?.runtime?.lastError || !response) {
                  return;
                }
                if (response.status === 'SUCCESS') {
                  const count = response.count ?? 0;
                  setSyncStatus('SUCCESS');
                  setSyncedCount(count);
                  setSyncMessage(
                    response.message || `Synced ${count} upcoming assignments across all classes`
                  );
                  setLastSyncedAt(new Date());
                  setTimeout(() => setSyncStatus('IDLE'), 4000);
                  resolve(response);
                  return;
                }
                if (response.status === 'NO_TEAMS') {
                  setSyncStatus('NO_TEAMS');
                  setSyncMessage(response.message || 'Teams not open (Open Teams to sync)');
                  resolve(response);
                  return;
                }
                resolve(response);
              }
            );
          } catch {
            clearTimeout(timeoutId);
          }
        });
      }

      return { status: 'SUCCESS', message: 'Sync dispatched via content bridge' };
    },
    [extensionId, activeUserId]
  );

  // Ping extension to check installation
  const pingExtension = useCallback(
    async (targetExtId?: string): Promise<boolean> => {
      // 1. Send window.postMessage to companion extension content bridge
      if (typeof window !== 'undefined') {
        window.postMessage({ type: 'HARK_PING_EXTENSION' }, '*');
      }

      const activeExtId = (targetExtId || extensionId).trim();
      if (!activeExtId || typeof window === 'undefined' || !window.chrome?.runtime?.sendMessage) {
        return isInstalled;
      }

      setIsChecking(true);
      setError(null);

      return new Promise<boolean>((resolve) => {
        const timeoutId = setTimeout(() => {
          setIsChecking(false);
          resolve(isInstalled);
        }, 1200);

        try {
          window.chrome!.runtime!.sendMessage(
            activeExtId,
            { type: 'HARK_PING' },
            (response) => {
              clearTimeout(timeoutId);
              setIsChecking(false);

              if (
                window.chrome?.runtime?.lastError ||
                !response ||
                response.status !== 'installed'
              ) {
                resolve(isInstalled);
              } else {
                setIsInstalled(true);
                setIsPaired(true);
                setVersion(response.version || '1.0.0');

                if (activeUserId) {
                  pairUser(activeUserId, activeExtId);
                }

                resolve(true);
              }
            }
          );
        } catch {
          clearTimeout(timeoutId);
          setIsChecking(false);
          resolve(isInstalled);
        }
      });
    },
    [extensionId, isInstalled, activeUserId, pairUser]
  );

  // Trigger ping whenever extensionId changes
  useEffect(() => {
    if (extensionId) {
      pingExtension(extensionId);
    }
  }, [extensionId, pingExtension]);

  // When activeUserId changes and extension is already installed, update pairing
  useEffect(() => {
    if (isInstalled && activeUserId && extensionId) {
      pairUser(activeUserId, extensionId);
    }
  }, [activeUserId, isInstalled, extensionId, pairUser]);

  // Trigger auto-sync once installed and paired on load
  useEffect(() => {
    if (isInstalled && activeUserId && !hasAutoSyncedRef.current) {
      hasAutoSyncedRef.current = true;
      triggerAutoSync();
    }
  }, [isInstalled, activeUserId, triggerAutoSync]);

  // Listen for broadcast HARK_EXTENSION_PONG, HARK_AUTO_SYNC_RESPONSE, and HARK_SYNC_COMPLETED
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBroadcast = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      // Handle pong from extension content script
      if (event.data.type === 'HARK_EXTENSION_PONG') {
        setIsInstalled(true);
        setIsPaired(true);
        setIsChecking(false);
        if (event.data.version) setVersion(event.data.version);
        if (event.data.extensionId) {
          setExtensionIdState(event.data.extensionId);
          try {
            localStorage.setItem(STORAGE_KEY_EXT_ID, event.data.extensionId);
          } catch {}
        }
      }

      // Handle auto sync response via window postMessage bridge
      if (event.data.type === 'HARK_AUTO_SYNC_RESPONSE') {
        const resp = event.data.response;
        if (resp) {
          if (resp.status === 'SUCCESS') {
            const count = resp.count ?? 0;
            setSyncStatus('SUCCESS');
            setSyncedCount(count);
            setSyncMessage(resp.message || `Synced ${count} upcoming assignments across all classes`);
            setLastSyncedAt(new Date());
            setTimeout(() => setSyncStatus('IDLE'), 4000);
          } else if (resp.status === 'NO_TEAMS') {
            setSyncStatus('NO_TEAMS');
            setSyncMessage(resp.message || 'Teams not open (Open Teams to sync)');
          } else {
            setSyncStatus('ERROR');
            setSyncMessage(resp.error || resp.message || 'Failed to sync assignments');
            setTimeout(() => setSyncStatus('IDLE'), 4000);
          }
        }
      }

      // Handle completed sync pushed from background service worker
      if (event.data.type === 'HARK_SYNC_COMPLETED' && event.data.source === 'hark-extension') {
        const count = event.data.count ?? 0;
        setSyncStatus('SUCCESS');
        setSyncedCount(count);
        setSyncMessage(event.data.message || `Synced ${count} upcoming assignments across all classes`);
        setLastSyncedAt(new Date());

        setTimeout(() => {
          setSyncStatus('IDLE');
        }, 4000);
      }
    };

    window.addEventListener('message', handleBroadcast);

    // Proactively ping extension content bridge immediately
    window.postMessage({ type: 'HARK_PING_EXTENSION' }, '*');

    // Periodic ping check every 4 seconds to maintain real-time connection status
    const pingTimer = setInterval(() => {
      window.postMessage({ type: 'HARK_PING_EXTENSION' }, '*');
    }, 4000);

    return () => {
      window.removeEventListener('message', handleBroadcast);
      clearInterval(pingTimer);
    };
  }, []);

  return {
    isInstalled,
    isChecking,
    isPaired,
    extensionId,
    version,
    error,
    syncStatus,
    syncedCount,
    syncMessage,
    lastSyncedAt,
    pingExtension,
    pairUser,
    triggerAutoSync,
    setExtensionId,
  };
}
