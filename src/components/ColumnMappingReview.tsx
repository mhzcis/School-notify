/**
 * Review/override Excel column → student field mapping before import is applied.
 */
import React from 'react';
import {
  ColumnAssignment,
  FIELD_LABELS,
  IMPORTABLE_FIELDS,
  MappedField,
  canAssignField,
  isIgnoredHeader,
} from '../lib/excelMapping';

interface Props {
  headers: string[];
  autoMap: Record<string, MappedField>;
  overrides: Record<string, ColumnAssignment>;
  onChange: (overrides: Record<string, ColumnAssignment>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ColumnMappingReview({ headers, autoMap, overrides, onChange, onConfirm, onCancel }: Props) {
  const uniqueHeaders = headers.filter(Boolean);
  const assignment = (h: string): ColumnAssignment => overrides[h] ?? autoMap[h] ?? 'ignore';

  return (
    <div className="mt-4 bg-white border border-indigo-100 rounded-xl p-4 space-y-3" id="column-mapping-review">
      <div>
        <h4 className="text-sm font-black text-slate-800">مطابقة الأعمدة قبل الحفظ</h4>
        <p className="text-[11px] text-slate-500 mt-1">
          راجع اقتراح النظام وعدّل إن لزم. لا يمكن ربط عمود الاسم الإنجليزي باسم الطالب العربي، ولا عمود مهنة ولي الأمر باسم ولي الأمر. أعمدة الملاحظات وكلمات المرور تُتجاهل ولا تُستورد.
        </p>
      </div>
      <div className="max-h-[280px] overflow-y-auto border border-slate-100 rounded-lg">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="p-2 font-bold">عمود الملف</th>
              <th className="p-2 font-bold">الحقل في التطبيق</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {uniqueHeaders.map(h => {
              const current = assignment(h);
              const blocked = isIgnoredHeader(h);
              return (
                <tr key={h} className={blocked ? 'bg-slate-50 text-slate-400' : ''}>
                  <td className="p-2 font-mono text-[11px]">{h}</td>
                  <td className="p-2">
                    <select
                      value={current}
                      disabled={blocked}
                      onChange={e => onChange({ ...overrides, [h]: e.target.value as ColumnAssignment })}
                      className="w-full border border-slate-200 rounded-md px-2 py-1 bg-white"
                      id={`column-map-${h}`}
                    >
                      <option value="ignore">تجاهل هذا العمود</option>
                      {IMPORTABLE_FIELDS.filter(f => canAssignField(h, f) || current === f).map(f => (
                        <option key={f} value={f} disabled={!canAssignField(h, f)}>{FIELD_LABELS[f]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700">إلغاء</button>
        <button type="button" onClick={onConfirm} id="confirm-column-mapping" className="px-4 py-2 rounded-xl text-xs font-black bg-indigo-600 text-white">متابعة مع هذه المطابقة</button>
      </div>
    </div>
  );
}
