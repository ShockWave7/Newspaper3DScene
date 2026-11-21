import React from 'react';
import {
  Box,
  Circle,
  Cone,
  Copy,
  Cylinder,
  Eye,
  EyeOff,
  FileBox,
  Flame,
  Hexagon,
  Lightbulb,
  Pill,
  Square,
  Sun,
  Torus,
  Trash2,
  Upload,
} from 'lucide-react';
import { LIGHT_LABELS, PRIMITIVE_LABELS } from '../editor/sceneModel';
import type { LightKind, PrimitiveType, SceneNode } from '../editor/types';

interface OutlinerPanelProps {
  nodes: SceneNode[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onAddPrimitive: (type: PrimitiveType) => void;
  onAddLight: (kind: LightKind) => void;
  onImportGlbClick: () => void;
  onToggleVisibility: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
}

const PRIMITIVE_ITEMS: { type: PrimitiveType; label: string; icon: React.ReactNode }[] = [
  { type: 'box', label: 'Куб', icon: <Box className="w-4 h-4" /> },
  { type: 'sphere', label: 'Сфера', icon: <Circle className="w-4 h-4" /> },
  { type: 'cylinder', label: 'Цилиндр', icon: <Cylinder className="w-4 h-4" /> },
  { type: 'cone', label: 'Конус', icon: <Cone className="w-4 h-4" /> },
  { type: 'torus', label: 'Тор', icon: <Torus className="w-4 h-4" /> },
  { type: 'torusKnot', label: 'Узел', icon: <Torus className="w-4 h-4 rotate-45" /> },
  { type: 'capsule', label: 'Капсула', icon: <Pill className="w-4 h-4" /> },
  { type: 'icosahedron', label: 'Призма', icon: <Hexagon className="w-4 h-4" /> },
  { type: 'plane', label: 'Плоскость', icon: <Square className="w-4 h-4" /> },
];

const LIGHT_ITEMS: { kind: LightKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'directional', label: 'Солнце', icon: <Sun className="w-3.5 h-3.5" /> },
  { kind: 'point', label: 'Точка', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { kind: 'spot', label: 'Спот', icon: <Flame className="w-3.5 h-3.5" /> },
];

function getNodeSubtitle(node: SceneNode): string {
  if (node.kind === 'primitive' && node.primitiveType) {
    return PRIMITIVE_LABELS[node.primitiveType];
  }
  if (node.kind === 'light' && node.light) {
    return LIGHT_LABELS[node.light.lightKind];
  }
  return 'Модель GLB';
}

function getNodeIcon(node: SceneNode): React.ReactNode {
  if (node.kind === 'light') return <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (node.kind === 'glb') return <FileBox className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  return <Box className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
}

export const OutlinerPanel: React.FC<OutlinerPanelProps> = ({
  nodes,
  selectedNodeId,
  onSelectNode,
  onAddPrimitive,
  onAddLight,
  onImportGlbClick,
  onToggleVisibility,
  onDuplicateNode,
  onDeleteNode,
}) => {
  return (
    <aside
      aria-label="Инструменты и иерархия сцены"
      className="w-64 lg:w-72 bg-[#16191E] border-r border-white/10 flex flex-col shrink-0 h-full overflow-hidden"
    >
      {/* Quick Add Primitives & Lights */}
      <div className="p-3 border-b border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-200">Добавить в сцену</h2>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {PRIMITIVE_ITEMS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => onAddPrimitive(item.type)}
              aria-label={`Добавить ${PRIMITIVE_LABELS[item.type]}`}
              className="flex flex-col items-center justify-center gap-1 py-2 px-1.5 rounded-md bg-[#1B1F26] hover:bg-[#242A34] border border-white/5 hover:border-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              {item.icon}
              <span className="text-[11px] font-medium whitespace-nowrap">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {LIGHT_ITEMS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => onAddLight(item.kind)}
              aria-label={`Добавить ${LIGHT_LABELS[item.kind]}`}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#1B1F26] hover:bg-[#242A34] border border-white/5 hover:border-amber-400/30 text-slate-300 hover:text-amber-200 transition-colors text-[11px] font-medium whitespace-nowrap cursor-pointer"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onImportGlbClick}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-[#111317] hover:bg-[#1B1F26] border border-dashed border-white/20 hover:border-[#3B82F6] text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-[#3B82F6]" />
          <span>Загрузить .GLB модель</span>
        </button>
      </div>

      {/* Scene Hierarchy Outliner */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-2.5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-200">Объекты сцены</h2>
          <span className="text-xs font-mono-tabular text-slate-400" data-testid="node-count">
            {nodes.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto studio-scroll p-2 space-y-1">
          {nodes.length === 0 ? (
            <div className="py-8 px-3 text-center text-xs text-slate-500">
              Сцена пуста. Добавьте примитив или перетащите .glb файл во вьюпорт.
            </div>
          ) : (
            nodes.map((node) => {
              const selected = node.id === selectedNodeId;
              return (
                <div
                  key={node.id}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md border transition-colors ${
                    selected
                      ? 'bg-[#3B82F6]/15 border-[#3B82F6]/50 text-white'
                      : 'bg-transparent border-transparent hover:bg-white/5 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                    aria-pressed={selected}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left cursor-pointer"
                  >
                    {getNodeIcon(node)}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{node.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {getNodeSubtitle(node)}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleVisibility(node.id)}
                      aria-label={node.visible ? `Скрыть ${node.name}` : `Показать ${node.name}`}
                      title={node.visible ? 'Скрыть' : 'Показать'}
                      className={`p-1 rounded hover:bg-white/10 transition-colors cursor-pointer ${
                        node.visible ? 'text-slate-400 hover:text-white' : 'text-slate-600'
                      }`}
                    >
                      {node.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateNode(node.id)}
                      aria-label={`Дублировать ${node.name}`}
                      title="Дублировать"
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteNode(node.id)}
                      aria-label={`Удалить ${node.name}`}
                      title="Удалить"
                      className="p-1 rounded text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
};
