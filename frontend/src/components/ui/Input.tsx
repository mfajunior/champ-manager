import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id ?? props.name;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        className={`border bg-white px-3 py-2.5 text-sm text-foreground outline-none focus:border-secondary ${
          error ? 'border-destructive' : 'border-border'
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs font-semibold text-destructive">{error}</span>}
    </div>
  );
}
