import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChampionshipForm } from '../components/championships/ChampionshipForm';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import {
  useChampionships,
  useDeleteChampionship,
  useUpdateChampionship,
} from '../hooks/useChampionships';
import { formatDate } from '../lib/format';
import { getErrorMessage } from '../lib/errors';
import type { Championship } from '../types';

// Ação de arquivar/desarquivar troca só is_active — como cada card usa
// um id diferente, o hook precisa ser instanciado por card, não uma vez só
// pra tela inteira. Esse componente existe só por causa dessa regra do
// React (hooks não podem ser chamados dentro de um .map diretamente).
function ArchiveButton({
  championship,
  label,
  nextIsActive,
}: {
  championship: Championship;
  label: string;
  nextIsActive: boolean;
}) {
  const updateChampionship = useUpdateChampionship(championship.id);
  return (
    <button
      onClick={(e) => {
        e.preventDefault(); // não navega pro Link que envolve o card
        updateChampionship.mutate({ is_active: nextIsActive });
      }}
      disabled={updateChampionship.isPending}
      className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function ChampionshipCard({
  championship,
  onRequestDelete,
}: {
  championship: Championship;
  onRequestDelete: (championship: Championship) => void;
}) {
  return (
    <div className="flex flex-col border border-border bg-card transition-colors hover:border-secondary">
      <Link to={`/admin/campeonatos/${championship.id}`} className="p-5">
        <h2 className="text-xl">{championship.name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {formatDate(championship.date)} · {championship.location}
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {championship.teams_count ?? 0} equipes · {championship.workouts_count ?? 0} provas
        </p>
      </Link>
      <div className="flex items-center justify-end gap-4 border-t border-border px-5 py-3">
        {championship.is_active ? (
          <ArchiveButton championship={championship} label="Arquivar" nextIsActive={false} />
        ) : (
          <ArchiveButton championship={championship} label="Desarquivar" nextIsActive={true} />
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            onRequestDelete(championship);
          }}
          className="text-xs font-bold uppercase tracking-wider text-destructive hover:opacity-70"
        >
          Excluir
        </button>
      </div>
    </div>
  );
}

export function ChampionshipsPage() {
  const { data: championships, isLoading, isError, error } = useChampionships();
  const [isCreating, setIsCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [championshipToDelete, setChampionshipToDelete] = useState<Championship | null>(null);

  // A lista com include_archived só é buscada quando a seção está aberta —
  // sem isso, toda visita à tela pagaria a query extra à toa.
  const { data: allChampionships, isLoading: isLoadingArchived } = useChampionships(showArchived);
  const archived = allChampionships?.filter((c) => !c.is_active) ?? [];

  const deleteChampionship = useDeleteChampionship();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl">Campeonatos</h1>
        <Button onClick={() => setIsCreating(true)}>Novo campeonato</Button>
      </div>

      {isLoading && <Spinner label="Carregando campeonatos..." />}
      {isError && <ErrorBanner message={getErrorMessage(error)} />}

      {championships && championships.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum campeonato ativo. Crie um novo ou veja os arquivados abaixo.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {championships?.map((championship) => (
          <ChampionshipCard
            key={championship.id}
            championship={championship}
            onRequestDelete={setChampionshipToDelete}
          />
        ))}
      </div>

      <div className="mt-8 border-t border-border pt-4">
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {showArchived ? 'Ocultar arquivados' : 'Ver arquivados'}
        </button>

        {showArchived && (
          <div className="mt-4">
            {isLoadingArchived && <Spinner label="Carregando arquivados..." />}
            {!isLoadingArchived && archived.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum campeonato arquivado.</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {archived.map((championship) => (
                <ChampionshipCard
                  key={championship.id}
                  championship={championship}
                  onRequestDelete={setChampionshipToDelete}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {isCreating && (
        <Modal title="Novo campeonato" onClose={() => setIsCreating(false)}>
          <ChampionshipForm onCreated={() => setIsCreating(false)} />
        </Modal>
      )}

      {championshipToDelete && (
        <ConfirmDialog
          title="Excluir campeonato permanentemente"
          message={`Excluir "${championshipToDelete.name}" apaga para sempre todas as equipes, provas, baterias e resultados lançados — não tem como desfazer. Se só quer tirá-lo da lista por enquanto, use "Arquivar" em vez disso.`}
          confirmLabel="Excluir para sempre"
          isLoading={deleteChampionship.isPending}
          onCancel={() => setChampionshipToDelete(null)}
          onConfirm={async () => {
            await deleteChampionship.mutateAsync(championshipToDelete.id);
            setChampionshipToDelete(null);
          }}
        />
      )}
    </div>
  );
}
