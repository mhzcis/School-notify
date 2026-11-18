/**
 * Save the current recipient selection as a named group, or reuse a saved group.
 * Stale national IDs (students no longer in the list) are dropped and counted.
 */
import React, { useState } from 'react';
import { BookmarkPlus, Trash2, Users } from 'lucide-react';
import { resolveGroupMembers, type RecipientGroup } from '../lib/recipientGroups';
import type { Student } from '../types';

interface RecipientGroupsBarProps {
  students: Student[];
  selectedIds: string[];
  groups: RecipientGroup[];
  onSave: (title: string, ids: string[]) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onApply: (ids: string[], skippedCount: number, title: string) => void;
}

export default function RecipientGroupsBar({
  students, selectedIds, groups, onSave, onDelete, onApply,
}: RecipientGroupsBarProps) {
  const [title, setTitle] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const save = async () => {
    if (!selectedIds.length || busy) return;
    const name = title.trim();
    if (!name) {
      setHint('اكتب اسماً للمجموعة قبل الحفظ.');
      return;
    }
    setBusy(true);
    try {
      await onSave(name, selectedIds);
      setTitle('');
      setHint(`تم حفظ المجموعة «${name}» (${selectedIds.length} طالب).`);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const group = groups.find(g => g.id === selectedGroupId);
    if (!group) return;
    const resolved = resolveGroupMembers(group, students);
    onApply(resolved.matchedIds, resolved.skippedCount, group.title);
    if (resolved.skippedCount) {
      setHint(`تم تحديد (${resolved.matchedIds.length}) من «${group.title}»، وتخطي (${resolved.skippedCount}) رقم هوية لم يعد موجوداً.`);
    } else {
      setHint(`تم تحديد (${resolved.matchedIds.length}) طالب من مجموعة «${group.title}».`);
    }
  };

  const remove = async () => {
    const group = groups.find(g => g.id === selectedGroupId);
    if (!group || busy) return;
    if (!window.confirm(`حذف المجموعة «${group.title}»؟ لن يُحذف أي طالب.`)) return;
    setBusy(true);
    try {
      await onDelete(group.id);
      setSelectedGroupId('');
      setHint('تم حذف المجموعة.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2" id="recipient-groups-bar">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <Users className="w-4 h-4 text-emerald-600" />
        مجموعات المستلمين المحفوظة
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          id="select-saved-group"
          value={selectedGroupId}
          onChange={e => setSelectedGroupId(e.target.value)}
          className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
        >
          <option value="">اختر مجموعة محفوظة…</option>
          {groups.map(g => (
            <option key={g.id} value={g.id}>{g.title} ({g.studentNationalIds.length})</option>
          ))}
        </select>
        <button
          type="button"
          id="btn-apply-group"
          disabled={!selectedGroupId}
          onClick={apply}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          استخدام المجموعة
        </button>
        <button
          type="button"
          id="btn-delete-group"
          disabled={!selectedGroupId || busy}
          onClick={() => void remove()}
          className="px-2 py-1.5 rounded-lg text-[11px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
        >
          <Trash2 className="w-3.5 h-3.5" /> حذف
        </button>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          id="input-new-group-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="اسم مجموعة جديدة، مثل: غير الداخلين — رابع 1"
          className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
        />
        <button
          type="button"
          id="btn-save-group"
          disabled={!selectedIds.length || busy}
          onClick={() => void save()}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1"
        >
          <BookmarkPlus className="w-3.5 h-3.5" />
          حفظ التحديد ({selectedIds.length})
        </button>
      </div>
      {hint && <p className="text-[11px] text-slate-600" id="recipient-groups-hint">{hint}</p>}
    </div>
  );
}
