import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ProtectedLayout } from './components/layout/ProtectedLayout';
import { AuthProvider } from './context/AuthContext';
import { ChampionshipDetailPage } from './pages/ChampionshipDetailPage';
import { ChampionshipsPage } from './pages/ChampionshipsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicLeaderboardPage } from './pages/PublicLeaderboardPage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkoutDetailPage } from './pages/WorkoutDetailPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Único fluxo sem token: o organizador precisa entrar antes de
              cadastrar qualquer coisa (authMiddleware no backend exige isso
              em toda escrita). */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/registrar" element={<RegisterPage />} />

          {/* Placar público: mesma rota que qualquer participante no box
              acessa pelo celular, sem login — o backend não exige token em
              GET /api/leaderboard. */}
          <Route path="/placar/:championshipId" element={<PublicLeaderboardPage />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<ChampionshipsPage />} />
            <Route path="/campeonatos/:id" element={<ChampionshipDetailPage />} />
            <Route path="/campeonatos/:id/provas/:workoutId" element={<WorkoutDetailPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
