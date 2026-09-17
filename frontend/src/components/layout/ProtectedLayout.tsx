import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Header } from './Header';

// Todo mundo que cadastra/edita algo (campeonato, equipe, prova, resultado)
// passa por aqui. As telas de LEITURA pública (leaderboard) ficam fora desse
// layout de propósito — o backend também não exige token nelas.
export function ProtectedLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
