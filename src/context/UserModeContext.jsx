import { createContext, useContext, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  APP_MODES,
  getDefaultAppPath as getDefaultAppPathForMode,
  getStoredUserMode,
  getUserModeStorageKey,
  normalizeMode,
  setStoredUserMode,
} from '../lib/navigation';

const UserModeContext = createContext(null);

export function UserModeProvider({ children }) {
  const { user, isAdmin } = useAuth();
  const [modeOverrides, setModeOverrides] = useState({});
  const storageKey = user && !isAdmin ? getUserModeStorageKey(user.id) : null;
  const mode = storageKey
    ? normalizeMode(modeOverrides[storageKey] ?? getStoredUserMode(user.id))
    : APP_MODES.RENTER;

  const setMode = (nextMode) => {
    const normalized = normalizeMode(nextMode);

    if (storageKey && user && !isAdmin) {
      setModeOverrides((previous) => ({ ...previous, [storageKey]: normalized }));
      setStoredUserMode(user.id, normalized);
    }
  };

  const value = {
    mode,
    setMode,
    isRenterMode: mode === APP_MODES.RENTER,
    isListerMode: mode === APP_MODES.LISTER,
    getDefaultAppPath: () => getDefaultAppPathForMode({ isAdmin, mode }),
  };

  return <UserModeContext.Provider value={value}>{children}</UserModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUserMode() {
  const context = useContext(UserModeContext);

  if (!context) {
    throw new Error('useUserMode must be used within a UserModeProvider');
  }

  return context;
}
