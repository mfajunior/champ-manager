import { ApiError } from './api';

// Toda tela de formulário precisa disso no catch — centralizado para não
// repetir "instanceof ApiError ? ... : 'erro genérico'" em cada componente.
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Algo deu errado. Tente novamente.';
}
