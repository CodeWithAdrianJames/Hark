'use client';

import { useState, useEffect, useCallback } from 'react';

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

export interface HarkExtensionState {
  isInstalled: boolean;
  isChecking: boolean;
  isPaired: boolean;
  extensionId: string;
  version: string | null;
  error: string | null;
  pingExtension: (customId?: string) => Promise<boolean>;
  pairUser: (targetUserId: string, customId?: string) => Promise<boolean>;
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

  // Ping extension to check installation
  const pingExtension = useCallback(
    async (targetExtId?: string): Promise<boolean> => {
      const activeExtId = (targetExtId || extensionId).trim();

      if (!activeExtId) {
        setIsChecking(false);
        setIsInstalled(false);
        return false;
      }

      if (typeof window === 'undefined' || !window.chrome?.runtime?.sendMessage) {
        setIsChecking(false);
        setIsInstalled(false);
        return false;
      }

      setIsChecking(true);
      setError(null);

      return new Promise<boolean>((resolve) => {
        // Safety timeout to prevent hanging on unresponsive or invalid extension IDs
        const timeoutId = setTimeout(() => {
          setIsChecking(false);
          setIsInstalled(false);
          resolve(false);
        }, 1200);

        try {
          window.chrome!.runtime!.sendMessage(
            activeExtId,
            { type: 'HARK_PING' },
            (response) => {
              clearTimeout(timeoutId);
              setIsChecking(false);

              if (window.chrome?.runtime?.lastError || !response || response.status !== 'installed') {
                setIsInstalled(false);
                setIsPaired(false);
                resolve(false);
              } else {
                setIsInstalled(true);
                setVersion(response.version || '1.0.0');

                // If an active user ID is provided, automatically trigger pairing
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
          setIsInstalled(false);
          resolve(false);
        }
      });
    },
    [extensionId, activeUserId, pairUser]
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

  return {
    isInstalled,
    isChecking,
    isPaired,
    extensionId,
    version,
    error,
    pingExtension,
    pairUser,
    setExtensionId,
  };
}
