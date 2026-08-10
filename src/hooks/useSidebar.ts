import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'ideon-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persists the app sidebar's collapsed/expanded state across reloads. */
export function useSidebarState() {
  const [collapsed, setCollapsed] = useState<boolean>(getInitialCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // ignore storage errors
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle };
}
