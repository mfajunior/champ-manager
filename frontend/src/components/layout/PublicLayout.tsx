import type { ReactNode } from 'react';
import { PublicHeader } from './PublicHeader';
import { Sidebar } from './Sidebar';

/**
 * Casca comum das 6 telas públicas (Home, hub do evento, provas, detalhe da
 * prova, baterias, leaderboard): header + menu lateral + conteúdo. Centralizado
 * aqui em vez de repetido em cada página — trocar o menu (adicionar item,
 * mudar texto, mudar largura) é uma edição só, não seis.
 *
 * O conteúdo (children) continua limitado a max-w-4xl, igual antes de existir
 * o menu lateral — só a linha em volta (header + menu + conteúdo) ficou mais
 * larga (max-w-6xl) pra sobrar espaço pro menu sem espremer o conteúdo.
 */
export function PublicLayout({
  championshipId,
  subtitle,
  liveBadge,
  children,
}: {
  championshipId?: number;
  subtitle?: string;
  liveBadge?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <PublicHeader subtitle={subtitle} liveBadge={liveBadge} />

      <div className="mx-auto flex max-w-6xl">
        <Sidebar championshipId={championshipId} />

        {/* px-4 no celular: 24px de cada lado tiravam 48px de uma tela de 360px,
            e é justamente nas tabelas que esse espaço faltava. */}
        <main className="min-w-0 flex-1 px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-4xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
