import type { ApiEnvelope, ApiErrorBody } from '../types';

// Vazio por padrão = caminho relativo ("/api/...", ver função request
// abaixo), resolvido pelo navegador contra a própria origem da página. Em
// desenvolvimento (`npm run dev`), o proxy do Vite (vite.config.ts) encaminha
// esses caminhos para o backend em localhost:5000 — funciona igual acessando
// de localhost, do celular na wifi, ou de fora via túnel, sem precisar
// configurar IP nenhum. Em produção (`vite build`), esse proxy não existe:
// VITE_API_URL precisa apontar pro backend publicado (ver README.md).
const API_URL = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'champy_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/**
 * Erro de API tipado, para o `catch` de quem chamou distinguir "backend
 * respondeu com um erro de negócio" (com `code`, ex.: RESULTS_EXIST,
 * CONFLICT) de um erro de rede genérico.
 */
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean; // manda o header Authorization quando true (padrão)
}

/**
 * Wrapper único de fetch para toda a aplicação. Centraliza três coisas que,
 * espalhadas em cada chamada, seriam fonte garantida de bug:
 *  1. montar a URL base a partir de VITE_API_URL
 *  2. anexar o Bearer token quando a rota exige (authMiddleware no backend)
 *  3. transformar o formato de erro do backend ({ error: { code, message } })
 *     numa exceção JS de verdade, em vez de cada tela reimplementar isso
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // DELETE bem-sucedido devolve { data: null, meta } — ainda assim tem corpo
  // JSON no ScoreUp (nenhuma rota usa 204), então sempre dá para fazer parse.
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const errorBody = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? 'UNKNOWN_ERROR',
      errorBody?.error?.message ?? `Erro ${response.status} ao chamar a API`
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<ApiEnvelope<T>>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<ApiEnvelope<T>>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<ApiEnvelope<T>>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<ApiEnvelope<T>>(path, { ...options, method: 'DELETE' }),
};
