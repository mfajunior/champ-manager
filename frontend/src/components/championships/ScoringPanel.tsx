import { useState } from 'react';
import { PointsTableEditor } from './PointsTableEditor';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Modal } from '../ui/Modal';
import { WarningBanner } from '../ui/WarningBanner';
import {
  useDeletePointsTable,
  usePointsTables,
  useSetScoringModel,
} from '../../hooks/usePointsTables';
import { getErrorMessage } from '../../lib/errors';
import { ApiError } from '../../lib/api';
import type { Championship, PointsTable } from '../../types';

/**
 * Configuração de pontuação do campeonato: qual modelo vale e, no modelo
 * novo, qual tabela é a régua.
 *
 * O 409 NÃO É ERRO, É PERGUNTA
 *
 * Quando o campeonato já tem resultados lançados, o backend recusa a troca
 * com RESULTS_EXIST e diz quantos resultados serão recalculados. Tratar isso
 * como falha e mostrar um banner vermelho seria mentir: a operação é
 * legítima, o backend só quer que alguém confirme conscientemente. Então o
 * 409 vira diálogo de confirmação, com o número que veio na mensagem.
 *
 * A troca inverte o placar — onde a menor soma de colocações liderava, passa
 * a liderar a maior soma de pontos. É o tipo de mudança que assusta quem não
 * esperava.
 */
export function ScoringPanel({ championship }: { championship: Championship }) {
  const [editando, setEditando] = useState<PointsTable | null | undefined>(undefined);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<PointsTable | null>(null);
  const [confirmacaoDeTroca, setConfirmacaoDeTroca] = useState<{
    mensagem: string;
    tabelaId: number | null;
    modelo: 'legacy' | 'points_table';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tabelas = usePointsTables(championship.id);
  const trocarModelo = useSetScoringModel(championship.id);
  const excluir = useDeletePointsTable(championship.id);

  const usandoPontos = championship.scoring_model === 'points_table';

  const aplicarModelo = async (
    modelo: 'legacy' | 'points_table',
    tabelaId: number | null,
    confirm = false
  ) => {
    setError(null);
    try {
      await trocarModelo.mutateAsync({
        scoring_model: modelo,
        points_table_id: tabelaId,
        confirm,
      });
      setConfirmacaoDeTroca(null);
    } catch (err) {
      // RESULTS_EXIST é pedido de confirmação, não falha.
      if (err instanceof ApiError && err.code === 'RESULTS_EXIST') {
        setConfirmacaoDeTroca({ mensagem: err.message, tabelaId, modelo });
        return;
      }
      setError(getErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorBanner message={error} />}

      <div>
        <h3 className="mb-1 text-lg font-semibold">Como o placar é calculado</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Vale para todas as provas do campeonato, as já cadastradas e as próximas.
        </p>

        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer items-start gap-3 border border-border px-4 py-3">
            <input
              type="radio"
              name="scoring_model"
              className="mt-1"
              checked={!usandoPontos}
              onChange={() => aplicarModelo('legacy', championship.points_table_id)}
            />
            <span>
              <span className="block text-sm font-semibold">Pontuação padrão</span>
              <span className="block text-xs text-muted-foreground">
                Soma das colocações de cada prova. Menor soma vence.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 border border-border px-4 py-3">
            <input
              type="radio"
              name="scoring_model"
              className="mt-1"
              checked={usandoPontos}
              disabled={(tabelas.data?.length ?? 0) === 0}
              onChange={() =>
                aplicarModelo('points_table', championship.points_table_id ?? tabelas.data?.[0]?.id ?? null)
              }
            />
            <span>
              <span className="block text-sm font-semibold">Estilo CrossFit Games</span>
              <span className="block text-xs text-muted-foreground">
                Cada colocação vale pontos, segundo a tabela escolhida. Mais pontos vence.
              </span>
            </span>
          </label>
        </div>

        {(tabelas.data?.length ?? 0) === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Crie uma tabela de pontos abaixo para poder usar este modelo.
          </p>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Tabelas de pontos</h3>
          <Button variant="ghost" onClick={() => setEditando(null)}>
            Nova tabela
          </Button>
        </div>

        {tabelas.isPending && <p className="text-sm text-muted-foreground">Carregando...</p>}

        {tabelas.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma tabela criada ainda.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {tabelas.data?.map((tabela) => {
            const emUso = championship.points_table_id === tabela.id;
            return (
              <div
                key={tabela.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-border px-4 py-3"
              >
                <div>
                  <span className="text-sm font-semibold">{tabela.name}</span>
                  {emUso && (
                    <span className="ml-2 border border-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                      em uso
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    1º lugar: {tabela.max_points} pontos · {tabela.ranges.length} faixa
                    {tabela.ranges.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex gap-2">
                  {usandoPontos && !emUso && (
                    <Button
                      variant="ghost"
                      onClick={() => aplicarModelo('points_table', tabela.id)}
                    >
                      Usar esta
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setEditando(tabela)}>
                    Editar
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmandoExclusao(tabela)}>
                    Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editando !== undefined && (
        <Modal
          title={editando ? 'Editar tabela de pontos' : 'Nova tabela de pontos'}
          onClose={() => setEditando(undefined)}
        >
          <PointsTableEditor
            championshipId={championship.id}
            table={editando}
            onSaved={() => setEditando(undefined)}
            onCancel={() => setEditando(undefined)}
          />
        </Modal>
      )}

      {confirmandoExclusao && (
        <ConfirmDialog
          title="Excluir tabela de pontos"
          message={`Excluir "${confirmandoExclusao.name}"? Se ela estiver em uso por algum campeonato, a exclusão será recusada.`}
          confirmLabel="Excluir"
          isLoading={excluir.isPending}
          onCancel={() => setConfirmandoExclusao(null)}
          onConfirm={async () => {
            setError(null);
            try {
              await excluir.mutateAsync(confirmandoExclusao.id);
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setConfirmandoExclusao(null);
            }
          }}
        />
      )}

      {confirmacaoDeTroca && (
        <Modal title="Trocar a pontuação do campeonato" onClose={() => setConfirmacaoDeTroca(null)}>
          <div className="flex flex-col gap-4">
            <WarningBanner message={confirmacaoDeTroca.mensagem} />
            <p className="text-sm text-muted-foreground">
              Os resultados lançados não são apagados — só a forma de somá-los muda.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirmacaoDeTroca(null)}>
                Cancelar
              </Button>
              <Button
                disabled={trocarModelo.isPending}
                onClick={() =>
                  aplicarModelo(
                    confirmacaoDeTroca.modelo,
                    confirmacaoDeTroca.tabelaId,
                    true
                  )
                }
              >
                {trocarModelo.isPending ? 'Recalculando...' : 'Trocar e recalcular'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
