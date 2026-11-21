import React from 'react';
import {
  Camera,
  Download,
  EyeOff,
  FolderOpen,
  Grid3x3,
  Magnet,
  Maximize2,
  MousePointer,
  Move,
  RotateCw,
  Save,
  Scale,
  Upload,
} from 'lucide-react';
import type { TransformMode, TransformSpace } from '../editor/types';

interface TopToolbarProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  transformMode: TransformMode;
  onTransformModeChange: (mode: TransformMode) => void;
  transformSpace: TransformSpace;
  onTransformSpaceToggle: () => void;
  snapEnabled: boolean;
  onSnapToggle: () => void;
  gridVisible: boolean;
  onGridToggle: () => void;
  hasSelection: boolean;
  onFocusSelected: () => void;
  zenMode: boolean;
  onZenModeToggle: () => void;
  onOpenProjects: () => void;
  onImportClick: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onSaveLocal: () => void;
  saveFeedback: string | null;
}

const TRANSFORM_MODES: { mode: TransformMode; label: string; keyHint: string; icon: React.ReactNode }[] = [
  { mode: 'select', label: 'Выбор', keyHint: 'Q', icon: <MousePointer className="w-3.5 h-3.5" /> },
  { mode: 'translate', label: 'Перемещение', keyHint: 'W', icon: <Move className="w-3.5 h-3.5" /> },
  { mode: 'rotate', label: 'Вращение', keyHint: 'E', icon: <RotateCw className="w-3.5 h-3.5" /> },
  { mode: 'scale', label: 'Масштаб', keyHint: 'R', icon: <Scale className="w-3.5 h-3.5" /> },
];

export const TopToolbar: React.FC<TopToolbarProps> = ({
  projectName,
  onProjectNameChange,
  transformMode,
  onTransformModeChange,
  transformSpace,
  onTransformSpaceToggle,
  snapEnabled,
  onSnapToggle,
  gridVisible,
  onGridToggle,
  hasSelection,
  onFocusSelected,
  zenMode,
  onZenModeToggle,
  onOpenProjects,
  onImportClick,
  onExportJson,
  onExportPng,
  onSaveLocal,
  saveFeedback,
}) => {
  return (
    <header className="h-12 bg-[#16191E] border-b border-white/10 px-3 flex items-center justify-between gap-3 shrink-0 select-none">
      {/* Zone 1: Brand & Editable Project Title */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          Forma3D
        </span>
        <span className="text-white/20 shrink-0" aria-hidden="true">
          /
        </span>
        <input
          type="text"
          aria-label="Название проекта"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          className="bg-transparent text-xs font-medium text-slate-200 hover:bg-white/5 focus:bg-[#111317] focus:outline-none focus:ring-1 focus:ring-[#3B82F6] rounded px-2 py-1 w-40 lg:w-48 truncate transition-colors"
        />
      </div>

      {/* Zone 2: Transform & Viewport Controls */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <div
          role="group"
          aria-label="Режим трансформации"
          className="flex items-center bg-[#111317] p-0.5 rounded-md border border-white/10 shrink-0"
        >
          {TRANSFORM_MODES.map((item) => {
            const active = transformMode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                onClick={() => onTransformModeChange(item.mode)}
                title={`${item.label} (${item.keyHint})`}
                aria-label={`${item.label} (${item.keyHint})`}
                aria-pressed={active}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#3B82F6] text-white'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
                }`}
              >
                {item.icon}
                <span className="hidden xl:inline">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-white/10 shrink-0" aria-hidden="true" />

        <button
          type="button"
          onClick={onTransformSpaceToggle}
          title="Система координат (Мировая / Локальная)"
          aria-label={`Система координат: ${transformSpace === 'world' ? 'Мировая' : 'Локальная'}`}
          className="px-2.5 py-1 text-xs font-medium rounded-md border border-white/10 bg-[#111317] text-slate-300 hover:text-white hover:border-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {transformSpace === 'world' ? 'Мир' : 'Лок.'}
        </button>

        <button
          type="button"
          onClick={onSnapToggle}
          aria-pressed={snapEnabled}
          title="Привязка к сетке (0.25м / 15°)"
          aria-label="Привязка к сетке"
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            snapEnabled
              ? 'bg-[#3B82F6]/20 border-[#3B82F6]/60 text-blue-300'
              : 'bg-[#111317] border-white/10 text-slate-400 hover:text-slate-100'
          }`}
        >
          <Magnet className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Привязка</span>
        </button>

        <button
          type="button"
          onClick={onGridToggle}
          aria-pressed={gridVisible}
          title="Показать или скрыть сетку"
          aria-label="Сетка координат"
          className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            gridVisible
              ? 'bg-white/10 border-white/20 text-slate-100'
              : 'bg-[#111317] border-white/10 text-slate-500 hover:text-slate-200'
          }`}
        >
          <Grid3x3 className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onFocusSelected}
          title={hasSelection ? 'Сфокусировать камеру на объекте (F)' : 'Сбросить вид камеры (F)'}
          aria-label="Сфокусировать камеру"
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md border border-white/10 bg-[#111317] text-slate-300 hover:text-white hover:border-white/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onZenModeToggle}
          aria-pressed={zenMode}
          title="Скрыть или показать боковые панели (H)"
          aria-label={zenMode ? 'Показать панели' : 'Скрыть панели'}
          className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            zenMode
              ? 'bg-[#3B82F6]/20 border-[#3B82F6]/60 text-blue-300'
              : 'bg-[#111317] border-white/10 text-slate-400 hover:text-slate-100'
          }`}
        >
          <EyeOff className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Zone 3: Project Persistence & Import/Export */}
      <div className="flex items-center gap-1.5 shrink-0">
        {saveFeedback && (
          <span className="text-xs text-emerald-400 mr-1 whitespace-nowrap">{saveFeedback}</span>
        )}

        <button
          type="button"
          onClick={onOpenProjects}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Проекты</span>
        </button>

        <button
          type="button"
          onClick={onImportClick}
          title="Импортировать .glb модель или .json проект"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Импорт</span>
        </button>

        <button
          type="button"
          onClick={onExportJson}
          title="Экспортировать сцену в JSON-файл"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Экспорт</span>
        </button>

        <button
          type="button"
          onClick={onExportPng}
          title="Сохранить PNG снимок вьюпорта"
          aria-label="Снимок PNG"
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Camera className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onSaveLocal}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-[#3B82F6] hover:bg-blue-500 text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Сохранить</span>
        </button>
      </div>
    </header>
  );
};
