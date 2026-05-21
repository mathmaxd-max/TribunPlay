import { getStoredIdentity } from '../auth/identityStore';

/** Guests may create friend games only from the Play with a Friend page, not tooling shortcuts. */
export const canCreateFriendLobbyFromTooling = (): boolean =>
  getStoredIdentity()?.mode === 'token';
