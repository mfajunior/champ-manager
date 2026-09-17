import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Renderiza sempre em document.body via portal, não onde o componente foi
 * chamado na árvore. Sem isso, um modal aberto de dentro de uma linha de
 * tabela (LaneRow, por exemplo) viraria um <div> filho direto de <tr> — HTML
 * inválido, já que <tr> só aceita <td>/<th> — e o navegador reposiciona esse
 * conteúdo sozinho de um jeito imprevisível. Com portal, a posição do modal
 * no DOM final nunca depende de quem o invocou.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-secondary/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-xl leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
