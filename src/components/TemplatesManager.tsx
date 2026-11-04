/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { PLACEHOLDERS } from '../lib/template';
import { MessageTemplate } from '../types';
import { Plus, Edit2, Trash2, Save, X, Sparkles, BookOpen, Clock, Megaphone, ReceiptText, School } from 'lucide-react';

interface TemplatesManagerProps {
  templates: MessageTemplate[];
  onAddTemplate: (newTemplate: Omit<MessageTemplate, 'id'>) => void;
  onUpdateTemplate: (updatedTemplate: MessageTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}

export default function TemplatesManager({
  templates,
  onAddTemplate,
  onUpdateTemplate,
  onDeleteTemplate
}: TemplatesManagerProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MessageTemplate['category']>('general');

  // Placeholders that are supported by the messaging engine

  const handleInsertPlaceholder = (placeholder: string, isDraftNew: boolean) => {
    if (isDraftNew) {
      setContent(prev => prev + ' ' + placeholder + ' ');
    } else if (editingId) {
      // Find the input element or modify state directly
      const input = document.getElementById(`edit-textarea-${editingId}`) as HTMLTextAreaElement;
      if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const currentVal = input.value;
        const newVal = currentVal.substring(0, start) + ' ' + placeholder + ' ' + currentVal.substring(end);
        
        onUpdateTemplate({
          ...templates.find(t => t.id === editingId)!,
          content: newVal
        });
        
        // Reset cursor focus
        setTimeout(() => {
          input.focus();
          input.setSelectionRange(start + placeholder.length + 2, start + placeholder.length + 2);
        }, 10);
      } else {
        // Fallback update
        onUpdateTemplate({
          ...templates.find(t => t.id === editingId)!,
          content: templates.find(t => t.id === editingId)!.content + ' ' + placeholder + ' '
        });
      }
    }
  };

  const handleSaveAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    onAddTemplate({
      title,
      content,
      category
    });

    // Reset
    setTitle('');
    setContent('');
    setCategory('general');
    setIsAdding(false);
  };

  const startEdit = (template: MessageTemplate) => {
    setEditingId(template.id);
  };

  const handleFieldChange = (id: string, field: keyof MessageTemplate, value: any) => {
    const original = templates.find(t => t.id === id);
    if (original) {
      onUpdateTemplate({
        ...original,
        [field]: value
      });
    }
  };

  const categoryLabels: Record<MessageTemplate['category'], { label: string; color: string; icon: any }> = {
    general: { label: 'عام', color: 'bg-indigo-50 text-indigo-700 border-indigo-100', icon: Megaphone },
    attendance: { label: 'حضور وغياب', color: 'bg-rose-50 text-rose-700 border-rose-100', icon: Clock },
    grades: { label: 'الأداء والدراسة', color: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: BookOpen },
    fees: { label: 'رسوم مالية', color: 'bg-amber-50 text-amber-700 border-amber-100', icon: ReceiptText },
    events: { label: 'فعاليات واجتماعات', color: 'bg-sky-50 text-sky-700 border-sky-100', icon: School }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-xs" id="templates-manager-container">
      <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            قوالب الرسائل الجاهزة
          </h2>
          <p className="text-sm text-slate-500 mt-1">وفر جهدك بالصياغة المكررة واستخدم المتغيرات التلقائية الذكية</p>
        </div>

        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1.5 px-4 font-bold py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition text-sm shadow-xs hover:shadow-md"
            id="btn-add-template-toggle"
          >
            <Plus className="w-4 h-4" />
            إنشاء قالب جديد
          </button>
        )}
      </div>

      {/* Creation form */}
      {isAdding && (
        <form onSubmit={handleSaveAdd} className="bg-slate-50/70 rounded-xl p-5 border border-indigo-100/50 mb-6" id="add-template-form">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800 text-sm">قالب رسالة جديد</h3>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-600 mb-1">اسم/عنوان القالب</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="مثال: تذكير بالرسوم الدراسية المتأخرة"
                className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg text-sm transition outline-hidden"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">تصنيف القالب</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as MessageTemplate['category'])}
                className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg text-sm transition outline-hidden"
              >
                <option value="general">عام / تعميم</option>
                <option value="attendance">حضور وغياب</option>
                <option value="grades">الأداء والدراسة</option>
                <option value="fees">رسوم مالية</option>
                <option value="events">فعاليات واجتماعات</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-600">محتوى نص القالب</label>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] text-slate-400 ml-1">انقر لإدراج متغير:</span>
                {PLACEHOLDERS.map(ph => (
                  <button
                    key={ph.tag}
                    type="button"
                    onClick={() => handleInsertPlaceholder(ph.tag, true)}
                    className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 text-[10px] rounded hover:scale-105 transition cursor-pointer"
                    title={`سيتم استبدال هذا المتغير تلقائياً بكل طالب`}
                  >
                    {ph.label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="اكتب رسالتك هنا. استخدم الأزرار أعلاه لتخصيص محتواها لكل ولي أمر، مثل: السلام عليكم سيد {{اسم_ولي_الأمر}}، نود إعلامكم..."
              rows={4}
              className="w-full px-3 py-2 bg-white border border-slate-200 focus:border-indigo-500 rounded-lg text-sm transition outline-hidden leading-relaxed"
              required
            />
          </div>

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-medium text-slate-600"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-xs shadow-xs"
            >
              حفظ القالب الجديد
            </button>
          </div>
        </form>
      )}

      {/* Grid of Templates */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="templates-grid">
        {templates.map(template => {
          const isEditing = editingId === template.id;
          const cat = categoryLabels[template.category] || categoryLabels.general;
          const CatIcon = cat.icon;

          return (
            <div
              key={template.id}
              className={`border rounded-xl p-5 flex flex-col justify-between transition duration-200 ${
                isEditing
                  ? 'border-indigo-500 bg-indigo-50/10 shadow-xs'
                  : 'border-slate-100 bg-slate-50/20 hover:border-slate-200 hover:bg-white hover:shadow-xs'
              }`}
              id={`template-card-${template.id}`}
            >
              {isEditing ? (
                /* Inline editing state */
                <div className="space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={template.title}
                      onChange={e => handleFieldChange(template.id, 'title', e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold"
                    />
                    <select
                      value={template.category}
                      onChange={e => handleFieldChange(template.id, 'category', e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-slate-200 rounded-md text-xs"
                    >
                      <option value="general">عام / تعميم</option>
                      <option value="attendance">حضور وغياب</option>
                      <option value="grades">الأداء والدراسة</option>
                      <option value="fees">رسوم مالية</option>
                      <option value="events">فعاليات واجتماعات</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1 mb-1">
                      {PLACEHOLDERS.map(ph => (
                        <button
                          key={ph.tag}
                          type="button"
                          onClick={() => handleInsertPlaceholder(ph.tag, false)}
                          className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 text-[9px] rounded"
                        >
                          +{ph.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      id={`edit-textarea-${template.id}`}
                      value={template.content}
                      onChange={e => handleFieldChange(template.id, 'content', e.target.value)}
                      rows={5}
                      className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-md text-xs leading-relaxed"
                    />
                  </div>

                  <div className="flex justify-end gap-1.5 pt-3">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-2 py-1 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded text-[11px]"
                    >
                      خروج
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-[11px] font-bold flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" />
                      حفظ التعديل
                    </button>
                  </div>
                </div>
              ) : (
                /* Static template card */
                <div className="flex flex-col justify-between h-full space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full border flex items-center gap-1 ${cat.color}`}>
                        <CatIcon className="w-3 h-3" />
                        {cat.label}
                      </span>
                      
                      <div className="flex opacity-60 hover:opacity-100 transition items-center gap-1">
                        <button
                          onClick={() => startEdit(template)}
                          className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                          title="تعديل القالب"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteTemplate(template.id)}
                          className="p-1 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-md transition cursor-pointer"
                          title="حذف القالب"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <h4 className="font-bold text-slate-800 text-sm leading-snug">{template.title}</h4>
                    <p className="text-xs text-slate-500 leading-relaxed mt-2 line-clamp-4 relative bg-slate-50/50 p-2.5 rounded-lg border border-slate-100/65">
                      {template.content}
                    </p>
                  </div>

                  <div className="pt-2 text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-100/70">
                    <span>الرمز البرمجي: <strong className="font-mono">{template.id}</strong></span>
                    <span>عدد الحقول المستخدمة: <strong className="text-slate-600 font-bold">{(template.content.match(/{{.*?}}/g) || []).length}</strong></span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
