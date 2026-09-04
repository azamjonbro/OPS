import type { LoginCredentials, LoginResult, User } from '@hadiya/shared';

import { api } from './http';

/**
 * Endpoints the auth module will expose. The paths are fixed now so the client
 * and the API are written against the same contract; calling them before the
 * module ships returns a 404 from the API.
 */
export const authService = {
  login: (credentials: LoginCredentials): Promise<LoginResult> =>
    api.post<LoginResult>('/v1/auth/login', credentials),
  logout: (): Promise<void> => api.post<void>('/v1/auth/logout'),
  currentUser: (): Promise<User> => api.get<User>('/v1/auth/me'),
};
