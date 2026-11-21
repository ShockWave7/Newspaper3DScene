import React from 'react';
import { FolderOpen, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import type { SavedProjectMeta } from '../editor/types';

interface ProjectsModalProps {
  open: boolean;
  currentProjectName: string;
  savedProjects: SavedProjectMeta[];
  onClose: () => void;
  onSaveCurrentSlot: () => void;
  onLoadSlot: (projectId: string) => void;
  onDeleteSlot: (projectId: string) => void;
  onLoadStarter: () => void;
  onCreateEmpty: () => void;
}

export const ProjectsModal: React.FC<ProjectsModalProps> = ({
  open,
  currentProjectName,
  savedProjects,
  onClose,
  onSaveCurrentSlot,
  onLoadSlot,
  onDeleteSlot,
  onLoadStarter,
  onCreateEmpty,
}) => {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="projects-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-lg bg-[#16191E] border border-white/15 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h2 id="projects-modal-title" className="text-sm font-semibold text-white">
            Проекты и шаблоны сцен
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно проектов"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto studio-scroll">
          {/* Save Current Action */}
          <div className="p-3 rounded-md bg-[#111317] border border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-white truncate">{currentProjectName}</div>
              <div className="text-[11px] text-slate-400">
                Сохранить текущую сцену в список локальных проектов
              </div>
            </div>
            <button
              type="button"
              onClick={onSaveCurrentSlot}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#3B82F6] hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Сохранить слот</span>
            </button>
          </div>

          {/* Presets */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">Шаблоны</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onLoadStarter}
                className="flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Стартовая студия</span>
              </button>
              <button
                type="button"
                onClick={onCreateEmpty}
                className="flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-blue-400" />
                <span>Пустая сцена</span>
              </button>
            </div>
          </div>

          {/* Saved Slots */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-300">
              Сохранённые в браузере ({savedProjects.length})
            </h3>
            {savedProjects.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-white/10 rounded-md">
                Пока нет сохранённых проектов. Нажмите «Сохранить слот», чтобы добавить текущий проект.
              </div>
            ) : (
              <div className="space-y-1.5">
                {savedProjects.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-md bg-[#1B1F26] border border-white/10"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-white truncate">{slot.name}</div>
                      <div className="text-[11px] text-slate-400 font-mono-tabular">
                        {slot.nodeCount} объектов · {new Date(slot.updatedAt).toLocaleString('ru-RU')}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onLoadSlot(slot.id)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/10 hover:bg-[#3B82F6] text-xs font-medium text-white transition-colors cursor-pointer"
                      >
                        <FolderOpen className="w-3 h-3" />
                        <span>Открыть</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSlot(slot.id)}
                        aria-label={`Удалить проект ${slot.name}`}
                        className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
