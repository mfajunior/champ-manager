import type { SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export function Select({ label, error, id, className = '', children, ...props }: SelectProps) {
  const selectId = id ?? props.name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-sm font-semibold text-foreground">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={`border bg-white px-3 py-2.5 text-sm text-foreground outline-none focus:border-secondary ${
          error ? 'border-destructive' : 'border-border'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
    </div>
  );
}
