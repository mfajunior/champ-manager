import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, clearToken, getToken, setSessionExpiredHandler, setToken } from '../lib/api';
import type { ApiEnvelope, User } from '../types';

const USER_KEY = 'champy_user';

interface AuthResponse {
  user: User;
  token: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  /** True quando a sessão caiu sozinha (token recusado), não por logout. */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  dismissSessionExpired: () => void;
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
  const [sessionExpired, setSessionExpired] = useState(false);

  const clearSession = () => {
    clearToken();
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  // O api.ts avisa por callback quando o backend recusa o token. Limpar o
  // usuário aqui basta para o ProtectedLayout redirecionar — não é preciso
  // mexer no router de dentro da camada de rede.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearSession();
      setSessionExpired(true);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const persistSession = (response: ApiEnvelope<AuthResponse>) => {
    setToken(response.data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(response.data.user));
    setUser(response.data.user);
    setSessionExpired(false);
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

  const logout = () => {
    clearSession();
    // Saiu por vontade própria: não é expiração, e o aviso não deve aparecer.
    setSessionExpired(false);
  };

  const dismissSessionExpired = () => setSessionExpired(false);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user && getToken()),
      sessionExpired,
      login,
      logout,
      dismissSessionExpired,
    }),
    [user, sessionExpired]
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
