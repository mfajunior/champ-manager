import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicLayout } from '../components/layout/PublicLayout';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Spinner } from '../components/ui/Spinner';
import { useChampionship } from '../hooks/useChampionships';
import { useWorkout } from '../hooks/useWorkouts';
import { SCORING_TYPE_LABELS } from '../lib/scoring';
import { categoriasComEquipe } from '../lib/categorias';
import { getErrorMessage } from '../lib/errors';

// Detalhe de uma prova, só leitura: o texto de cada variante (o WOD em si,
// por categoria) é o conteúdo que o atleta/torcida realmente quer ver aqui.
// Sem o seletor de "tipo de pontuação" nem o botão de "configurar baterias"
// que existem na versão de gestão (WorkoutDetailPage, em /admin) — isso é
// edição, fica só para quem logou.
export function PublicWorkoutDetailPage() {
  const { id: championshipIdParam, workoutId: workoutIdParam } = useParams<{
    id: string;
    workoutId: string;
  }>();
  const championshipId = Number(championshipIdParam);
  const workoutId = Number(workoutIdParam);
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');

  const championship = useChampionship(championshipId);
  const workout = useWorkout(workoutId);

  if (workout.isLoading || championship.isLoading) {
    return (
      <PublicLayout championshipId={championshipId}>
        <Spinner label="Carregando prova..." />
      </PublicLayout>
    );
  }

  if (workout.isError || !workout.data || !championship.data) {
    return (
      <PublicLayout championshipId={championshipId}>
        <ErrorBanner message={getErrorMessage(workout.error) || 'Prova não encontrada.'} />
      </PublicLayout>
    );
  }

  // Categoria sem equipe não vira filtro nem variante aqui (ver lib/categorias).
  const categories = categoriasComEquipe(championship.data.categories ?? []);
  const variantsByCategory = new Map(workout.data.variants?.map((v) => [v.category_id, v]) ?? []);
  // Mesmo padrão de filtro por categoria do placar público (PublicLeaderboardPage):
  // botões com o nome de cada categoria, "Todas" mostra tudo empilhado como
  // antes. Prova com muitas categorias virava uma rolagem longa pra achar a
  // sua — assim dá pra ir direto na categoria que importa.
  const visibleCategories =
    categoryFilter === 'all' ? categories : categories.filter((category) => category.id === categoryFilter);

  return (
    <PublicLayout championshipId={championshipId} subtitle={championship.data.name}>
      <Link
        to={`/evento/${championshipId}/provas`}
        className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
      >
        ← Provas
      </Link>

      <h1 className="mt-2 text-3xl">
        Prova {workout.data.workout_number} — {workout.data.name}
      </h1>
      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {SCORING_TYPE_LABELS[workout.data.scoring_type]}
      </p>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
              categoryFilter === 'all' ? 'border-brand text-brand' : 'border-border text-muted-foreground'
            }`}
          >
            Todas
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setCategoryFilter(category.id)}
              className={`border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${
                categoryFilter === category.id
                  ? 'border-brand text-brand'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        {visibleCategories.map((category) => {
          const variant = variantsByCategory.get(category.id);
          return (
            <div key={category.id} className="border border-border p-5">
              <h2 className="font-display text-lg uppercase tracking-wide text-brand">
                {category.name}
              </h2>
              {variant ? (
                /* O time cap NÃO aparece aqui, embora a variante tenha o
                   campo. O organizador escreve o WOD inteiro na descrição e
                   põe o cap na primeira linha, junto do formato ("FOR TIME |
                   TIME CAP 14 MIN") — é assim que um WOD é escrito no quadro
                   do box. Repetir o número embaixo mostrava a mesma
                   informação duas vezes, em dois formatos diferentes (14 MIN
                   e 14:00), que é pior do que não mostrar: quem lê para e
                   confere se são a mesma coisa.

                   O campo continua existindo e continua obrigatório na
                   prática — é dele que sai a duração da bateria no cronograma
                   (ver heatController.generate). Só não é exibido aqui. Na
                   tela do organizador ele continua visível, porque lá o
                   número tem função operacional: é o que ele confere antes de
                   gerar as baterias. */
                <p className="mt-2 whitespace-pre-wrap text-sm">{variant.description}</p>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  Ainda não definida para esta categoria.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </PublicLayout>
  );
}
