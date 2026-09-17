import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, getToken, setToken } from '../lib/api';
import type { ApiEnvelope, User } from '../types';

const USER_KEY = 'champy_user';

interface AuthResponse {
  user: User;
  token: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const readStoredUser = (): User | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readStoredUser());

  const persistSession = (response: ApiEnvelope<AuthResponse>) => {
    setToken(response.data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
    setUser(response.data.user);
  };

  const login = async (email: string, password: string) => {
    // auth: false porque ainda não existe token nenhum para mandar — e as
    // rotas de /api/auth também não passam por authMiddleware no backend.
    const response = await api.post<AuthResponse>(
      '/api/auth/login',
      { email, password },
      { auth: false }
    );
    persistSession(response);
  };

  const register = async (name: string, email: string, password: string) => {
    const response = await api.post<AuthResponse>(
      '/api/auth/register',
      { name, email, password },
      { auth: false }
    );
    persistSession(response);
  };

  const logout = () => {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, isAuthenticated: Boolean(user && getToken()), login, register, logout }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth precisa ser usado dentro de um <AuthProvider>');
  }
  return ctx;
}
