interface NomeComAtletasProps {
  nome: string;
  atleta1: string | null;
  atleta2: string | null;
  aberto: boolean;
  onAlternar: () => void;
}

/**
 * Nome da equipe que revela os dois atletas ao ser clicado.
 *
 * Expande DENTRO da própria célula, não numa linha irmã. É o que permite usar
 * o mesmo componente na tela pública, na do organizador e no modo de
 * remanejamento, que têm estruturas de tabela diferentes — uma `<tr>` extra
 * precisaria de colSpan específico de cada uma.
 *
 * Equipe sem atleta cadastrado não vira botão: não há o que revelar, e um
 * triângulo que abre para o vazio é pior que não ter triângulo.
 */
export function NomeComAtletas({
  nome,
  atleta1,
  atleta2,
  aberto,
  onAlternar,
}: NomeComAtletasProps) {
  const atletas = [atleta1, atleta2].filter((a): a is string => Boolean(a && a.trim()));

  if (atletas.length === 0) {
    return <span className="truncate">{nome}</span>;
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 text-left hover:opacity-70"
      >
        <span aria-hidden="true" className="text-xs text-muted-foreground">
          {aberto ? '▾' : '▸'}
        </span>
        <span className="truncate">{nome}</span>
      </button>

      {aberto && (
        <ul className="mt-1 pl-5 text-xs text-muted-foreground">
          {atletas.map((atleta) => (
            <li key={atleta} className="truncate">
              {atleta}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
