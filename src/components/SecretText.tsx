import React, { useState } from 'react';
import { SECRET_MASK } from '../lib/template';

export interface SecretTextProps {
  /** The real (sensitive) text. */
  value: string | undefined | null;
  /** What to show while hidden (defaults to a fixed mask that does not reveal the length). */
  maskedValue?: string;
  id?: string;
  className?: string;
  /** Render as a block with pre-wrapped lines (message previews). */
  block?: boolean;
}

/** Shows a masked value with an explicit "show" toggle. Never logs the value. */
export default function SecretText({ value, maskedValue, id, className, block }: SecretTextProps) {
  const [shown, setShown] = useState(false);
  if (!value) return <span className="text-slate-300">—</span>;
  const masked = maskedValue ?? SECRET_MASK;
  const needsToggle = masked !== value;
  const Tag: any = block ? 'div' : 'span';
  return (
    <Tag className={className} id={id}>
      <span data-testid="secret-text" className={block ? 'whitespace-pre-wrap' : 'font-mono'}>{shown ? value : masked}</span>
      {needsToggle && (
        <button
          type="button"
          onClick={() => setShown(v => !v)}
          className="mr-2 text-[10px] font-bold text-indigo-600 underline"
          data-testid="secret-toggle"
        >
          {shown ? 'إخفاء' : 'إظهار'}
        </button>
      )}
    </Tag>
  );
}
