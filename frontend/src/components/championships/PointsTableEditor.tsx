import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { Input } from '../ui/Input';
import { WarningBanner } from '../ui/WarningBanner';
import {
  useCreatePointsTable,
  useDraftPreview,
  useUpdatePointsTable,
} from '../../hooks/usePointsTables';
import { getErrorMessage } from '../../lib/errors';
import type { PointsTable, PointsTableRange } from '../../types';

const MAX_FAIXAS = 3;

/**
 * Editor da tabela de pontos.
 *
 * A DECISÃO CENTRAL DESTA TELA: O ORGANIZADOR NÃO DIGITA ONDE A FAIXA COMEÇA
 *
 * O banco guarda start_place e end_place, mas expor os dois aqui convidaria a
 * dois erros que a constraint trigger recusaria depois — faixa começando fora
 * da 1ª colocação e buraco entre faixas. Em vez de deixar errar e explicar o
 * erro, a tela torna o erro impossível: a primeira faixa começa na 1ª
 * colocação, cada faixa seguinte começa onde a anterior terminou, e só o FIM
 * e o DECREMENTO são digitados.
 *
 * A última faixa é sempre aberta ("em diante") e não tem campo de fim. Isso
 * garante, por construção, que nenhuma colocação fica sem pontuação —
 * inclusive as equipes que se inscreverem depois da tabela pronta.
 *
 * A validação do banco continua lá como rede de segurança, não como primeira
 * linha de defesa.
 */
interface FaixaEditavel {
  end_place: number | null;
  decrement: number;
}

const paraFaixasEditaveis = (ranges: PointsTableRange[]): FaixaEditavel[] =>
  ranges
    .slice()
    .sort((a, b) => a.start_place - b.start_place)
    .map((r) => ({ end_place: r.end_place, decrement: r.decrement }));

/** Deriva o start_place de cada faixa: a 1ª começa em 1, as outras onde a anterior parou. */
const paraRangesDaApi = (faixas: FaixaEditavel[]): PointsTableRange[] => {
  const out: PointsTableRange[] = [];
  let inicio = 1;
  faixas.forEach((faixa, i) => {
    const ultima = i === faixas.length - 1;
    const fim = ultima ? null : faixa.end_place;
    out.push({ start_place: inicio, end_place: fim, decrement: faixa.decrement });
    if (fim !== null) inicio = fim + 1;
  });
  return out;
};

export function PointsTableEditor({
  championshipId,
  table,
  onSaved,
  onCancel,
}: {
  championshipId: number;
  table: PointsTable | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(table?.name ?? 'Tabela de pontos');
  const [faixas, setFaixas] = useState<FaixaEditavel[]>(
    table ? paraFaixasEditaveis(table.ranges) : [{ end_place: null, decrement: 4 }]
  );
  const [error, setError] = useState<string | null>(null);

  const criar = useCreatePointsTable(championshipId);
  const atualizar = useUpdatePointsTable(championshipId, table?.id ?? 0);
  const salvando = criar.isPending || atualizar.isPending;

  const ranges = useMemo(() => paraRangesDaApi(faixas), [faixas]);

  // Cada faixa fechada precisa terminar depois de onde começa. Enquanto isso
  // não for verdade, nem vale pedir a pré-visualização ao servidor.
  const faixasCoerentes = ranges.every(
    (r) => r.end_place === null || r.end_place >= r.start_place
  );

  const preview = useDraftPreview(championshipId, faixasCoerentes ? ranges : null);

  const alterarFaixa = (indice: number, mudanca: Partial<FaixaEditavel>) => {
    setFaixas((atual) => atual.map((f, i) => (i === indice ? { ...f, ...mudanca } : f)));
  };

  const adicionarFaixa = () => {
    setFaixas((atual) => {
      const ultima = atual[atual.length - 1];
      const inicioDaUltima = paraRangesDaApi(atual)[atual.length - 1].start_place;
      // A que era aberta ganha um fim provisório; a nova entra como aberta.
      return [
        ...atual.slice(0, -1),
        { ...ultima, end_place: ultima.end_place ?? inicioDaUltima + 9 },
        { end_place: null, decrement: Math.max(1, ultima.decrement - 1) },
      ];
    });
  };

  const removerUltimaFaixa = () => {
    setFaixas((atual) =>
      atual.length <= 1
        ? atual
        : [...atual.slice(0, -2), { ...atual[atual.length - 2], end_place: null }]
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      if (table) {
        await atualizar.mutateAsync({ name, ranges });
      } else {
        await criar.mutateAsync({ name, ranges });
      }
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && <ErrorBanner message={error} />}

      <Input
        label="Nome da tabela"
        name="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="flex flex-col gap-3">
        <span className="text-sm font-semibold text-foreground">Faixas de pontuação</span>
        <p className="-mt-2 text-xs text-muted-foreground">
          O 1º lugar vale 100 pontos. Cada colocação seguinte perde o decremento
          da faixa em que ela está.
        </p>

        {faixas.map((faixa, i) => {
          const range = ranges[i];
          const ultima = i === faixas.length - 1;
          return (
            <div
              key={i}
              className="flex flex-wrap items-end gap-3 border border-border px-3 py-3"
            >
              <span className="pb-2.5 text-sm text-muted-foreground">
                Da {range.start_place}ª
              </span>

              {ultima ? (
                <span className="pb-2.5 text-sm font-semibold text-foreground">em diante</span>
              ) : (
                <div className="w-24">
                  <Input
                    label="até a"
                    type="number"
                    min={range.start_place}
                    required
                    value={faixa.end_place ?? ''}
                    onChange={(e) =>
                      alterarFaixa(i, { end_place: Number(e.target.value) || null })
                    }
                  />
                </div>
              )}

              <div className="w-28">
                <Input
                  label="decrescer"
                  type="number"
                  min={0}
                  required
                  value={faixa.decrement}
                  onChange={(e) => alterarFaixa(i, { decrement: Number(e.target.value) })}
                />
              </div>
              <span className="pb-2.5 text-sm text-muted-foreground">pontos</span>
            </div>
          );
        })}

        <div className="flex gap-3">
          {faixas.length < MAX_FAIXAS && (
            <Button type="button" variant="ghost" onClick={adicionarFaixa}>
              Adicionar faixa
            </Button>
          )}
          {faixas.length > 1 && (
            <Button type="button" variant="ghost" onClick={removerUltimaFaixa}>
              Remover última
            </Button>
          )}
        </div>
      </div>

      {/* PRÉ-VISUALIZAÇÃO
          Os números vêm do banco, da mesma função que calcula o placar de
          verdade — não de uma conta refeita aqui. Se fossem calculados no
          navegador, no dia em que a regra mudasse esta tela passaria a
          prometer uma coisa e o placar a entregar outra. */}
      <div className="border border-border">
        <div className="border-b border-border bg-muted px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Como fica a pontuação
        </div>

        {preview.isPending && (
          <p className="px-3 py-4 text-sm text-muted-foreground">Calculando...</p>
        )}

        {preview.isError && (
          <p className="px-3 py-4 text-sm text-destructive">
            {getErrorMessage(preview.error)}
          </p>
        )}

        {preview.data && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 py-3 text-sm">
              {preview.data.places.map(({ place, points }) => (
                <span
                  key={place}
                  className={points === 0 ? 'text-muted-foreground' : 'text-foreground'}
                >
                  <span className="text-xs text-muted-foreground">{place}º</span>{' '}
                  <span className="font-semibold">{points}</span>
                </span>
              ))}
            </div>

            {preview.data.zeroes_at !== null && (
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                A pontuação chega a zero na {preview.data.zeroes_at}ª colocação.
              </p>
            )}
          </>
        )}
      </div>

      {/* Informa, não bloqueia: zero é resultado legítimo, só precisa ser
          visível — porque zero também é o que recebe quem não competiu. */}
      {preview.data?.warning && <WarningBanner message={preview.data.warning} />}

      {table && (
        <WarningBanner message="Salvar recalcula o placar de todos os campeonatos que usam esta tabela." />
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={salvando || !faixasCoerentes}>
          {salvando ? 'Salvando...' : table ? 'Salvar alterações' : 'Criar tabela'}
        </Button>
      </div>
    </form>
  );
}
