import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ProtectedLayout } from './components/layout/ProtectedLayout';
import { AuthProvider } from './context/AuthContext';
import { ChampionshipDetailPage } from './pages/ChampionshipDetailPage';
import { ChampionshipsPage } from './pages/ChampionshipsPage';
import { EventHubPage } from './pages/EventHubPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicHeatsPage } from './pages/PublicHeatsPage';
import { PublicLeaderboardPage } from './pages/PublicLeaderboardPage';
import { PublicWorkoutDetailPage } from './pages/PublicWorkoutDetailPage';
import { PublicWorkoutsPage } from './pages/PublicWorkoutsPage';
import { WorkoutDetailPage } from './pages/WorkoutDetailPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ---- Público: nenhuma dessas rotas passa por authMiddleware no
              backend (GET em championships/workouts/heats é público lá;
              ver routes/*.js). A homepage deixou de ser a tela de login —
              é a primeira coisa que qualquer visitante vê, sem precisar
              entrar com conta nenhuma. */}
          <Route path="/" element={<HomePage />} />
          <Route path="/evento/:id" element={<EventHubPage />} />
          <Route path="/evento/:id/provas" element={<PublicWorkoutsPage />} />
          <Route path="/evento/:id/provas/:workoutId" element={<PublicWorkoutDetailPage />} />
          <Route path="/evento/:id/baterias" element={<PublicHeatsPage />} />
          <Route path="/placar/:championshipId" element={<PublicLeaderboardPage />} />

          {/* O login não sumiu — só não é mais a porta de entrada. Continua
              acessível direto por /login (link discreto "Área do organizador"
              em PublicHeader). Não existe mais autocadastro: só o organizador
              já cadastrado consegue entrar (conta criada direto no banco, ver
              DEVELOPMENT.md) — antes, qualquer pessoa que achasse /registrar
              conseguia criar uma conta com acesso total ao painel. */}
          <Route path="/login" element={<LoginPage />} />

          {/* ---- Área do organizador: cadastro/edição, sempre atrás de login.
              Vivia em "/" e "/campeonatos/*"; movida para "/admin/*" pra não
              colidir com as rotas públicas acima, que tomaram o lugar dela. */}
          <Route element={<ProtectedLayout />}>
            <Route path="/admin" element={<ChampionshipsPage />} />
            <Route path="/admin/campeonatos/:id" element={<ChampionshipDetailPage />} />
            <Route path="/admin/campeonatos/:id/provas/:workoutId" element={<WorkoutDetailPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
