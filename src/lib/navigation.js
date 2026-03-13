export const APP_MODES = {
  RENTER: 'renter',
  LISTER: 'lister',
};

export const USER_MODE_STORAGE_PREFIX = 'safedrive:user-mode:';

export function normalizeMode(mode) {
  return mode === APP_MODES.LISTER ? APP_MODES.LISTER : APP_MODES.RENTER;
}

export function getUserModeStorageKey(userId) {
  return `${USER_MODE_STORAGE_PREFIX}${userId}`;
}

export function getStoredUserMode(userId) {
  if (!userId || typeof window === 'undefined') {
    return APP_MODES.RENTER;
  }

  return normalizeMode(window.localStorage.getItem(getUserModeStorageKey(userId)));
}

export function setStoredUserMode(userId, mode) {
  if (!userId || typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getUserModeStorageKey(userId), normalizeMode(mode));
}

export function getDefaultAppPath({ isAdmin = false, mode = APP_MODES.RENTER } = {}) {
  if (isAdmin) {
    return '/admin';
  }

  return normalizeMode(mode) === APP_MODES.LISTER ? '/my-vehicles' : '/vehicles';
}
