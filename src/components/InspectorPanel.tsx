import React, { useState } from 'react';
import {
  ArrowDownToLine,
  Copy,
  Link,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlink,
} from 'lucide-react';
import {
  createDefaultPathTracerSettings,
  LIGHT_LABELS,
  PRIMITIVE_LABELS,
  roundTo,
} from '../editor/sceneModel';
import type {
  DenoiserStatus,
  DenoiserViewMode,
  LightProps,
  MaterialProps,
  PathTracerStatus,
  SceneNode,
  SceneSettings,
  TransformProps,
  Vec3Tuple,
} from '../editor/types';

interface InspectorPanelProps {
  selectedNode: SceneNode | null;
  sceneSettings: SceneSettings;
  pathTracerStatus: PathTracerStatus;
  denoiserStatus: DenoiserStatus;
  onUpdateNodeName: (id: string, name: string) => void;
  onUpdateTransform: (id: string, transform: TransformProps) => void;
  onUpdateMaterial: (id: string, material: MaterialProps) => void;
  onUpdateLight: (id: string, light: LightProps) => void;
  onUpdateNodeFlags: (
    id: string,
    flags: Partial<Pick<SceneNode, 'visible' | 'castShadow' | 'receiveShadow'>>,
  ) => void;
  onGroundNode: (id: string) => void;
  onFocusNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onUpdateSceneSettings: (settings: SceneSettings) => void;
  onResetPathTracer: () => void;
  onChangeDenoiserViewMode: (mode: DenoiserViewMode) => void;
  onResetCamera: () => void;
}

const BG_PRESETS = [
  { label: 'Обсидиан', color: '#13161c' },
  { label: 'Графит', color: '#1e2430' },
  { label: 'Студия', color: '#2b303a' },
  { label: 'Светлая', color: '#cbd5e1' },
];

const AXIS_COLORS: Record<keyof Vec3Tuple, string> = {
  x: 'text-red-400',
  y: 'text-emerald-400',
  z: 'text-blue-400',
};

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedNode,
  sceneSettings,
  pathTracerStatus,
  denoiserStatus,
  onUpdateNodeName,
  onUpdateTransform,
  onUpdateMaterial,
  onUpdateLight,
  onUpdateNodeFlags,
  onGroundNode,
  onFocusNode,
  onDuplicateNode,
  onDeleteNode,
  onUpdateSceneSettings,
  onResetPathTracer,
  onChangeDenoiserViewMode,
  onResetCamera,
}) => {
  const [activeTab, setActiveTab] = useState<'object' | 'scene'>('object');
  const [lockUniformScale, setLockUniformScale] = useState(false);

  const ptSettings = sceneSettings.pathTracer ?? createDefaultPathTracerSettings();
  const ptProgress = Math.min(
    100,
    Math.round((pathTracerStatus.samples / Math.max(1, ptSettings.maxSamples)) * 100),
  );
  const ptPhaseLabel =
    pathTracerStatus.phase === 'complete'
      ? 'Готово'
      : pathTracerStatus.phase === 'tracing'
        ? 'Трассировка'
        : pathTracerStatus.phase === 'paused'
          ? 'Пауза'
          : pathTracerStatus.phase === 'preview'
            ? 'Предпросмотр'
            : 'Ожидание';

  const denoiserProgressPct = Math.min(100, Math.max(0, Math.round(denoiserStatus.progress * 100)));
  const denoiserPhaseLabel =
    denoiserStatus.phase === 'ready'
      ? 'ИИ-денойз готов'
      : denoiserStatus.phase === 'denoising'
        ? `ИИ-денойз… ${denoiserProgressPct}%`
        : denoiserStatus.phase === 'loading-model'
          ? 'Загрузка весов OIDN…'
          : denoiserStatus.phase === 'unsupported'
            ? 'WebGPU недоступен — показан оригинал'
            : denoiserStatus.phase === 'error'
              ? denoiserStatus.errorMessage || 'Ошибка денойзера'
              : 'Запуск после завершения семплов';

  const effectiveTab = selectedNode ? activeTab : activeTab === 'scene' ? 'scene' : 'object';

  const handleVecChange = (
    group: 'position' | 'rotationDeg' | 'scale',
    axis: keyof Vec3Tuple,
    rawValue: string,
  ) => {
    if (!selectedNode) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;

    const nextTransform: TransformProps = {
      position: { ...selectedNode.transform.position },
      rotationDeg: { ...selectedNode.transform.rotationDeg },
      scale: { ...selectedNode.transform.scale },
    };

    if (group === 'scale') {
      const safeVal = Math.max(0.01, parsed);
      if (lockUniformScale) {
        const currentAxisVal = Math.max(0.01, selectedNode.transform.scale[axis]);
        const ratio = safeVal / currentAxisVal;
        nextTransform.scale = {
          x: roundTo(Math.max(0.01, selectedNode.transform.scale.x * ratio), 3),
          y: roundTo(Math.max(0.01, selectedNode.transform.scale.y * ratio), 3),
          z: roundTo(Math.max(0.01, selectedNode.transform.scale.z * ratio), 3),
        };
      } else {
        nextTransform.scale[axis] = safeVal;
      }
    } else {
      nextTransform[group][axis] = parsed;
    }

    onUpdateTransform(selectedNode.id, nextTransform);
  };

  const handleResetTransform = () => {
    if (!selectedNode) return;
    onUpdateTransform(selectedNode.id, {
      position: { x: 0, y: 0.5, z: 0 },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  };

  return (
    <aside
      aria-label="Инспектор свойств"
      className="w-72 lg:w-80 bg-[#16191E] border-l border-white/10 flex flex-col shrink-0 h-full overflow-hidden"
    >
      {/* Inspector Tabs */}
      <div className="p-2 border-b border-white/10">
        <div role="tablist" className="grid grid-cols-2 gap-1 p-1 bg-[#111317] rounded-md border border-white/10">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'object'}
            onClick={() => setActiveTab('object')}
            className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer ${
              effectiveTab === 'object'
                ? 'bg-[#242A34] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Объект
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveTab === 'scene'}
            onClick={() => setActiveTab('scene')}
            className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer ${
              effectiveTab === 'scene'
                ? 'bg-[#242A34] text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Сцена и рендер
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto studio-scroll p-3 space-y-4">
        {effectiveTab === 'object' ? (
          !selectedNode ? (
            <div className="py-10 px-4 text-center space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                Кликните по объекту на 3D-сцене или в списке слева, чтобы открыть его трансформации, материалы и тени.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('scene')}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors cursor-pointer"
              >
                Настройки сцены
              </button>
            </div>
          ) : (
            <>
              {/* Object Header & Quick Actions */}
              <section className="space-y-2.5 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-400">
                    {selectedNode.kind === 'primitive' && selectedNode.primitiveType
                      ? `Примитив · ${PRIMITIVE_LABELS[selectedNode.primitiveType]}`
                      : selectedNode.kind === 'light' && selectedNode.light
                        ? `Свет · ${LIGHT_LABELS[selectedNode.light.lightKind]}`
                        : 'Импортированная модель · GLB'}
                  </span>
                </div>

                <input
                  type="text"
                  aria-label="Имя объекта"
                  value={selectedNode.name}
                  onChange={(e) => onUpdateNodeName(selectedNode.id, e.target.value)}
                  className="w-full bg-[#111317] border border-white/10 focus:border-[#3B82F6] focus:outline-none rounded-md px-2.5 py-1.5 text-xs font-medium text-white"
                />

                <div className="flex items-center gap-1.5">
                  {selectedNode.kind !== 'light' && (
                    <button
                      type="button"
                      onClick={() => onGroundNode(selectedNode.id)}
                      title="Поставить объект ровно на пол (Y = 0)"
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer"
                    >
                      <ArrowDownToLine className="w-3 h-3" />
                      <span>На пол</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onFocusNode(selectedNode.id)}
                    title="Сфокусировать камеру (F)"
                    className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer"
                  >
                    <Maximize2 className="w-3 h-3" />
                    <span>Фокус</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicateNode(selectedNode.id)}
                    title="Дублировать"
                    aria-label="Дублировать выбранный объект"
                    className="p-1.5 rounded bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteNode(selectedNode.id)}
                    title="Удалить (Delete)"
                    aria-label="Удалить выбранный объект"
                    className="p-1.5 rounded bg-[#1B1F26] hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-slate-300 hover:text-red-300 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </section>

              {/* Transform Section */}
              <section className="space-y-3 pb-3 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200">Трансформация</h3>
                  <button
                    type="button"
                    onClick={handleResetTransform}
                    title="Сбросить позицию, поворот и масштаб"
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Сброс</span>
                  </button>
                </div>

                {/* Position */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400">Позиция (м)</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label
                        key={`pos-${axis}`}
                        className="flex items-center bg-[#111317] border border-white/10 focus-within:border-[#3B82F6] rounded px-1.5 py-1 gap-1"
                      >
                        <span className={`text-[10px] font-bold uppercase ${AXIS_COLORS[axis]}`}>
                          {axis}
                        </span>
                        <input
                          type="number"
                          step="0.1"
                          aria-label={`Позиция ${axis.toUpperCase()}`}
                          value={selectedNode.transform.position[axis]}
                          onChange={(e) => handleVecChange('position', axis, e.target.value)}
                          className="w-full bg-transparent text-xs font-mono-tabular text-slate-100 focus:outline-none min-w-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Rotation */}
                <div className="space-y-1">
                  <span className="text-[11px] text-slate-400">Поворот (°)</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label
                        key={`rot-${axis}`}
                        className="flex items-center bg-[#111317] border border-white/10 focus-within:border-[#3B82F6] rounded px-1.5 py-1 gap-1"
                      >
                        <span className={`text-[10px] font-bold uppercase ${AXIS_COLORS[axis]}`}>
                          {axis}
                        </span>
                        <input
                          type="number"
                          step="1"
                          aria-label={`Поворот ${axis.toUpperCase()}`}
                          value={selectedNode.transform.rotationDeg[axis]}
                          onChange={(e) => handleVecChange('rotationDeg', axis, e.target.value)}
                          className="w-full bg-transparent text-xs font-mono-tabular text-slate-100 focus:outline-none min-w-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                {/* Scale */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Масштаб</span>
                    <button
                      type="button"
                      onClick={() => setLockUniformScale((v) => !v)}
                      aria-pressed={lockUniformScale}
                      title="Пропорциональное масштабирование"
                      className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                        lockUniformScale ? 'text-blue-400 bg-blue-500/10' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {lockUniformScale ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                      <span>{lockUniformScale ? 'Связано' : 'Свободно'}</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label
                        key={`scale-${axis}`}
                        className="flex items-center bg-[#111317] border border-white/10 focus-within:border-[#3B82F6] rounded px-1.5 py-1 gap-1"
                      >
                        <span className={`text-[10px] font-bold uppercase ${AXIS_COLORS[axis]}`}>
                          {axis}
                        </span>
                        <input
                          type="number"
                          step="0.1"
                          min="0.01"
                          aria-label={`Масштаб ${axis.toUpperCase()}`}
                          value={selectedNode.transform.scale[axis]}
                          onChange={(e) => handleVecChange('scale', axis, e.target.value)}
                          className="w-full bg-transparent text-xs font-mono-tabular text-slate-100 focus:outline-none min-w-0"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              {/* GLB Metadata */}
              {selectedNode.kind === 'glb' && selectedNode.glbMeta && (
                <section className="space-y-2 pb-3 border-b border-white/10">
                  <h3 className="text-xs font-semibold text-slate-200">Данные модели .GLB</h3>
                  <div className="bg-[#111317] border border-white/10 rounded-md p-2.5 space-y-1.5 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Файл</span>
                      <span className="text-slate-200 truncate font-mono-tabular">
                        {selectedNode.glbMeta.fileName}
                      </span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-400">Меши / Треугольники</span>
                      <span className="text-slate-200 font-mono-tabular">
                        {selectedNode.glbMeta.meshCount} / {selectedNode.glbMeta.triangleCount.toLocaleString('ru-RU')}
                      </span>
                    </div>
                    {selectedNode.glbMeta.boundsSize && (
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-400">Габариты (Ш×В×Г)</span>
                        <span className="text-slate-200 font-mono-tabular">
                          {selectedNode.glbMeta.boundsSize.x} × {selectedNode.glbMeta.boundsSize.y} ×{' '}
                          {selectedNode.glbMeta.boundsSize.z}
                        </span>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Material Section (Primitives & GLB) */}
              {selectedNode.material && (selectedNode.kind === 'primitive' || selectedNode.kind === 'glb') && (
                <section className="space-y-3 pb-3 border-b border-white/10">
                  <h3 className="text-xs font-semibold text-slate-200">Материал (PBR)</h3>

                  {selectedNode.kind === 'glb' && (
                    <label className="flex items-center justify-between gap-2 p-2 rounded-md bg-[#111317] border border-white/10 cursor-pointer">
                      <span className="text-xs text-slate-200">Переопределить материал модели</span>
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.material.overrideGlbMaterial)}
                        onChange={(e) =>
                          onUpdateMaterial(selectedNode.id, {
                            ...selectedNode.material!,
                            overrideGlbMaterial: e.target.checked,
                          })
                        }
                        className="accent-[#3B82F6] w-3.5 h-3.5"
                      />
                    </label>
                  )}

                  {(selectedNode.kind === 'primitive' || selectedNode.material.overrideGlbMaterial) && (
                    <div className="space-y-3">
                      {/* Base Color */}
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="mat-color" className="text-xs text-slate-300">
                          Цвет (Albedo)
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            id="mat-color"
                            type="color"
                            value={selectedNode.material.color}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                color: e.target.value,
                              })
                            }
                            className="w-7 h-7 rounded bg-transparent border border-white/15 cursor-pointer"
                          />
                          <input
                            type="text"
                            aria-label="Hex код цвета"
                            value={selectedNode.material.color}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                color: e.target.value,
                              })
                            }
                            className="w-20 bg-[#111317] border border-white/10 rounded px-2 py-1 text-xs font-mono-tabular text-slate-200"
                          />
                        </div>
                      </div>

                      {/* Roughness */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <label htmlFor="mat-roughness" className="text-slate-300">
                            Шероховатость
                          </label>
                          <span className="font-mono-tabular text-slate-400">
                            {selectedNode.material.roughness.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="mat-roughness"
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={selectedNode.material.roughness}
                          onChange={(e) =>
                            onUpdateMaterial(selectedNode.id, {
                              ...selectedNode.material!,
                              roughness: Number(e.target.value),
                            })
                          }
                          className="w-full studio-range"
                        />
                      </div>

                      {/* Metalness */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <label htmlFor="mat-metalness" className="text-slate-300">
                            Металличность
                          </label>
                          <span className="font-mono-tabular text-slate-400">
                            {selectedNode.material.metalness.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="mat-metalness"
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={selectedNode.material.metalness}
                          onChange={(e) =>
                            onUpdateMaterial(selectedNode.id, {
                              ...selectedNode.material!,
                              metalness: Number(e.target.value),
                            })
                          }
                          className="w-full studio-range"
                        />
                      </div>

                      {/* Emissive */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor="mat-emissive" className="text-xs text-slate-300">
                            Свечение (Emissive)
                          </label>
                          <input
                            id="mat-emissive"
                            type="color"
                            value={selectedNode.material.emissive}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                emissive: e.target.value,
                              })
                            }
                            className="w-7 h-7 rounded bg-transparent border border-white/15 cursor-pointer"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <label htmlFor="mat-emissive-int" className="text-slate-400">
                              Сила свечения
                            </label>
                            <span className="font-mono-tabular text-slate-400">
                              {selectedNode.material.emissiveIntensity.toFixed(2)}
                            </span>
                          </div>
                          <input
                            id="mat-emissive-int"
                            type="range"
                            min="0"
                            max="3"
                            step="0.05"
                            value={selectedNode.material.emissiveIntensity}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                emissiveIntensity: Number(e.target.value),
                              })
                            }
                            className="w-full studio-range"
                          />
                        </div>
                      </div>

                      {/* Opacity */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <label htmlFor="mat-opacity" className="text-slate-300">
                            Непрозрачность
                          </label>
                          <span className="font-mono-tabular text-slate-400">
                            {selectedNode.material.opacity.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="mat-opacity"
                          type="range"
                          min="0.05"
                          max="1"
                          step="0.01"
                          value={selectedNode.material.opacity}
                          onChange={(e) =>
                            onUpdateMaterial(selectedNode.id, {
                              ...selectedNode.material!,
                              opacity: Number(e.target.value),
                              transparent: Number(e.target.value) < 0.999,
                            })
                          }
                          className="w-full studio-range"
                        />
                      </div>

                      {/* Wireframe & Flat Shading */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedNode.material.wireframe}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                wireframe: e.target.checked,
                              })
                            }
                            className="accent-[#3B82F6] w-3.5 h-3.5"
                          />
                          <span>Каркас</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedNode.material.flatShading}
                            onChange={(e) =>
                              onUpdateMaterial(selectedNode.id, {
                                ...selectedNode.material!,
                                flatShading: e.target.checked,
                              })
                            }
                            className="accent-[#3B82F6] w-3.5 h-3.5"
                          />
                          <span>Flat Shading</span>
                        </label>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Light Properties */}
              {selectedNode.kind === 'light' && selectedNode.light && (
                <section className="space-y-3 pb-3 border-b border-white/10">
                  <h3 className="text-xs font-semibold text-slate-200">Параметры освещения</h3>

                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="light-color" className="text-xs text-slate-300">
                      Цвет света
                    </label>
                    <input
                      id="light-color"
                      type="color"
                      value={selectedNode.light.color}
                      onChange={(e) =>
                        onUpdateLight(selectedNode.id, {
                          ...selectedNode.light!,
                          color: e.target.value,
                        })
                      }
                      className="w-8 h-7 rounded bg-transparent border border-white/15 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="light-intensity" className="text-slate-300">
                        Интенсивность
                      </label>
                      <span className="font-mono-tabular text-slate-400">
                        {selectedNode.light.intensity.toFixed(1)}
                      </span>
                    </div>
                    <input
                      id="light-intensity"
                      type="range"
                      min="0"
                      max={selectedNode.light.lightKind === 'directional' ? 100 : 80}
                      step="0.2"
                      value={selectedNode.light.intensity}
                      onChange={(e) =>
                        onUpdateLight(selectedNode.id, {
                          ...selectedNode.light!,
                          intensity: Number(e.target.value),
                        })
                      }
                      className="w-full studio-range"
                    />
                  </div>

                  {selectedNode.light.lightKind !== 'directional' && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <label htmlFor="light-distance" className="text-slate-300">
                          Дистанция (радиус)
                        </label>
                        <span className="font-mono-tabular text-slate-400">
                          {selectedNode.light.distance.toFixed(1)} м
                        </span>
                      </div>
                      <input
                        id="light-distance"
                        type="range"
                        min="0.5"
                        max="40"
                        step="0.5"
                        value={selectedNode.light.distance}
                        onChange={(e) =>
                          onUpdateLight(selectedNode.id, {
                            ...selectedNode.light!,
                            distance: Number(e.target.value),
                          })
                        }
                        className="w-full studio-range"
                      />
                    </div>
                  )}

                  {selectedNode.light.lightKind === 'spot' && (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <label htmlFor="light-angle" className="text-slate-300">
                            Угол конуса
                          </label>
                          <span className="font-mono-tabular text-slate-400">
                            {selectedNode.light.angleDeg}°
                          </span>
                        </div>
                        <input
                          id="light-angle"
                          type="range"
                          min="5"
                          max="85"
                          step="1"
                          value={selectedNode.light.angleDeg}
                          onChange={(e) =>
                            onUpdateLight(selectedNode.id, {
                              ...selectedNode.light!,
                              angleDeg: Number(e.target.value),
                            })
                          }
                          className="w-full studio-range"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <label htmlFor="light-penumbra" className="text-slate-300">
                            Мягкость края
                          </label>
                          <span className="font-mono-tabular text-slate-400">
                            {selectedNode.light.penumbra.toFixed(2)}
                          </span>
                        </div>
                        <input
                          id="light-penumbra"
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={selectedNode.light.penumbra}
                          onChange={(e) =>
                            onUpdateLight(selectedNode.id, {
                              ...selectedNode.light!,
                              penumbra: Number(e.target.value),
                            })
                          }
                          className="w-full studio-range"
                        />
                      </div>
                    </>
                  )}

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={selectedNode.light.castShadow}
                      onChange={(e) =>
                        onUpdateLight(selectedNode.id, {
                          ...selectedNode.light!,
                          castShadow: e.target.checked,
                        })
                      }
                      className="accent-[#3B82F6] w-3.5 h-3.5"
                    />
                    <span>Отбрасывать тени</span>
                  </label>

                  {selectedNode.light.lightKind === 'directional' && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-xs">
                        <label
                          htmlFor="light-shadow-intensity"
                          className={selectedNode.light.castShadow ? 'text-slate-300' : 'text-slate-500'}
                        >
                          Интенсивность теней
                        </label>
                        <span className="font-mono-tabular text-slate-400">
                          {(selectedNode.light.shadowIntensity ?? 1).toFixed(2)}
                        </span>
                      </div>
                      <input
                        id="light-shadow-intensity"
                        type="range"
                        min="0"
                        max="1"
                        step="0.02"
                        disabled={!selectedNode.light.castShadow}
                        value={selectedNode.light.shadowIntensity ?? 1}
                        onChange={(e) =>
                          onUpdateLight(selectedNode.id, {
                            ...selectedNode.light!,
                            shadowIntensity: Number(e.target.value),
                          })
                        }
                        className="w-full studio-range disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                  )}
                </section>
              )}

              {/* Visibility & Shadow Flags */}
              {selectedNode.kind !== 'light' && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-200">Отображение и тени</h3>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNode.visible}
                        onChange={(e) => onUpdateNodeFlags(selectedNode.id, { visible: e.target.checked })}
                        className="accent-[#3B82F6] w-3.5 h-3.5"
                      />
                      <span>Объект видим на сцене</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNode.castShadow}
                        onChange={(e) => onUpdateNodeFlags(selectedNode.id, { castShadow: e.target.checked })}
                        className="accent-[#3B82F6] w-3.5 h-3.5"
                      />
                      <span>Отбрасывать тень</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedNode.receiveShadow}
                        onChange={(e) => onUpdateNodeFlags(selectedNode.id, { receiveShadow: e.target.checked })}
                        className="accent-[#3B82F6] w-3.5 h-3.5"
                      />
                      <span>Принимать тени</span>
                    </label>
                  </div>
                </section>
              )}
            </>
          )
        ) : (
          /* Scene & Environment Tab */
          <div className="space-y-4">
            <section className="space-y-2.5 pb-3 border-b border-white/10">
              <h3 className="text-xs font-semibold text-slate-200">Фон и атмосфера</h3>

              <div className="flex items-center justify-between gap-2">
                <label htmlFor="scene-bg" className="text-xs text-slate-300">
                  Цвет фона
                </label>
                <input
                  id="scene-bg"
                  type="color"
                  value={sceneSettings.backgroundColor}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      backgroundColor: e.target.value,
                      fogColor: e.target.value,
                    })
                  }
                  className="w-8 h-7 rounded bg-transparent border border-white/15 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {BG_PRESETS.map((preset) => (
                  <button
                    key={preset.color}
                    type="button"
                    onClick={() =>
                      onUpdateSceneSettings({
                        ...sceneSettings,
                        backgroundColor: preset.color,
                        fogColor: preset.color,
                      })
                    }
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-[#111317] hover:bg-[#1B1F26] border border-white/10 text-[11px] text-slate-300 cursor-pointer"
                  >
                    <span
                      className="w-3 h-3 rounded-sm border border-white/20 shrink-0"
                      style={{ backgroundColor: preset.color }}
                    />
                    <span className="truncate">{preset.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3 pb-3 border-b border-white/10">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-200">Рендер и освещение</h3>
              </div>

              {/* Renderer Engine Switcher */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-slate-400">Движок рендеринга</span>
                <div
                  role="group"
                  aria-label="Движок рендеринга"
                  className="grid grid-cols-2 gap-1 p-1 bg-[#111317] rounded-md border border-white/10"
                >
                  <button
                    type="button"
                    data-testid="renderer-standard"
                    aria-pressed={sceneSettings.renderEngine === 'standard'}
                    onClick={() =>
                      onUpdateSceneSettings({
                        ...sceneSettings,
                        renderEngine: 'standard',
                      })
                    }
                    className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                      sceneSettings.renderEngine === 'standard'
                        ? 'bg-[#3B82F6] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Стандартный
                  </button>
                  <button
                    type="button"
                    data-testid="renderer-pathtracer"
                    aria-pressed={sceneSettings.renderEngine === 'pathtracer'}
                    onClick={() =>
                      onUpdateSceneSettings({
                        ...sceneSettings,
                        renderEngine: 'pathtracer',
                      })
                    }
                    className={`py-1.5 px-2 text-xs font-medium rounded transition-colors cursor-pointer ${
                      sceneSettings.renderEngine === 'pathtracer'
                        ? 'bg-[#3B82F6] text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    PathTracer
                  </button>
                </div>
              </div>

              {sceneSettings.renderEngine === 'pathtracer' && (
                <div className="p-2.5 rounded-md bg-[#111317] border border-white/10 space-y-3">
                  {/* Live Status + Sample Progress */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-slate-200">{ptPhaseLabel}</span>
                      <span className="font-mono-tabular text-slate-400">
                        {pathTracerStatus.samples} / {ptSettings.maxSamples}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-150 ${
                          pathTracerStatus.phase === 'complete' ? 'bg-emerald-500' : 'bg-[#3B82F6]'
                        }`}
                        style={{ width: `${ptProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Pause & Reset Controls */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      data-testid="pt-pause-toggle"
                      onClick={() =>
                        onUpdateSceneSettings({
                          ...sceneSettings,
                          pathTracer: {
                            ...ptSettings,
                            paused: !ptSettings.paused,
                          },
                        })
                      }
                      className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                        ptSettings.paused
                          ? 'bg-[#3B82F6]/20 border-[#3B82F6]/50 text-blue-300 hover:bg-[#3B82F6]/30'
                          : 'bg-[#1B1F26] border-white/10 text-slate-200 hover:bg-[#242A34]'
                      }`}
                    >
                      {ptSettings.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span>{ptSettings.paused ? 'Продолжить' : 'Пауза'}</span>
                    </button>
                    <button
                      type="button"
                      data-testid="pt-reset-btn"
                      onClick={onResetPathTracer}
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-[11px] font-medium text-slate-200 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Сбросить</span>
                    </button>
                  </div>

                  {/* Bounces */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="pt-bounces" className="text-slate-300">
                        Отскоки лучей
                      </label>
                      <span className="font-mono-tabular text-slate-400">{ptSettings.bounces}</span>
                    </div>
                    <input
                      id="pt-bounces"
                      type="range"
                      min="1"
                      max="12"
                      step="1"
                      value={ptSettings.bounces}
                      onChange={(e) =>
                        onUpdateSceneSettings({
                          ...sceneSettings,
                          pathTracer: {
                            ...ptSettings,
                            bounces: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full studio-range"
                    />
                  </div>

                  {/* Max Samples */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="pt-max-samples" className="text-slate-300">
                        Макс. семплов
                      </label>
                      <span className="font-mono-tabular text-slate-400">{ptSettings.maxSamples}</span>
                    </div>
                    <input
                      id="pt-max-samples"
                      type="range"
                      min="8"
                      max="512"
                      step="8"
                      value={ptSettings.maxSamples}
                      onChange={(e) =>
                        onUpdateSceneSettings({
                          ...sceneSettings,
                          pathTracer: {
                            ...ptSettings,
                            maxSamples: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full studio-range"
                    />
                  </div>

                  {/* Render Scale */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <label htmlFor="pt-render-scale" className="text-slate-300">
                        Масштаб разрешения
                      </label>
                      <span className="font-mono-tabular text-slate-400">
                        {Math.round(ptSettings.renderScale * 100)}%
                      </span>
                    </div>
                    <input
                      id="pt-render-scale"
                      type="range"
                      min="0.25"
                      max="1"
                      step="0.05"
                      value={ptSettings.renderScale}
                      onChange={(e) =>
                        onUpdateSceneSettings({
                          ...sceneSettings,
                          pathTracer: {
                            ...ptSettings,
                            renderScale: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full studio-range"
                    />
                  </div>

                  {/* AI Denoiser (OIDN WebGPU) */}
                  <div className="pt-2.5 border-t border-white/10 space-y-2">
                    <label className="flex items-center justify-between gap-2 text-xs text-slate-200 cursor-pointer">
                      <span>Авто-денойз (OIDN WebGPU)</span>
                      <input
                        type="checkbox"
                        data-testid="pt-denoiser-toggle"
                        checked={ptSettings.denoiserEnabled}
                        onChange={(e) =>
                          onUpdateSceneSettings({
                            ...sceneSettings,
                            pathTracer: {
                              ...ptSettings,
                              denoiserEnabled: e.target.checked,
                            },
                          })
                        }
                        className="accent-[#3B82F6] w-3.5 h-3.5"
                      />
                    </label>

                    {(ptSettings.denoiserEnabled || denoiserStatus.phase !== 'idle') && (
                      <div className="space-y-1.5">
                        <div
                          data-testid="pt-denoiser-status"
                          className={`text-[11px] leading-snug ${
                            denoiserStatus.phase === 'ready'
                              ? 'text-emerald-400'
                              : denoiserStatus.phase === 'unsupported' || denoiserStatus.phase === 'error'
                                ? 'text-amber-300'
                                : 'text-slate-400'
                          }`}
                        >
                          {denoiserPhaseLabel}
                        </div>

                        {(denoiserStatus.phase === 'loading-model' ||
                          denoiserStatus.phase === 'denoising') && (
                          <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 transition-all duration-150"
                              style={{
                                width:
                                  denoiserStatus.phase === 'loading-model'
                                    ? '18%'
                                    : `${Math.max(8, denoiserProgressPct)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {denoiserStatus.hasResult && denoiserStatus.phase === 'ready' && (
                      <div
                        role="group"
                        aria-label="Режим просмотра результата денойзера"
                        className="grid grid-cols-2 gap-1 p-0.5 bg-[#16191E] rounded border border-white/10"
                      >
                        <button
                          type="button"
                          data-testid="pt-view-denoised"
                          aria-pressed={denoiserStatus.viewMode === 'denoised'}
                          onClick={() => onChangeDenoiserViewMode('denoised')}
                          className={`py-1 px-2 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                            denoiserStatus.viewMode === 'denoised'
                              ? 'bg-emerald-600 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Денойз
                        </button>
                        <button
                          type="button"
                          data-testid="pt-view-original"
                          aria-pressed={denoiserStatus.viewMode === 'original'}
                          onClick={() => onChangeDenoiserViewMode('original')}
                          className={`py-1 px-2 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                            denoiserStatus.viewMode === 'original'
                              ? 'bg-[#3B82F6] text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Оригинал
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <label htmlFor="scene-exposure" className="text-slate-300">
                    Экспозиция (ACES)
                  </label>
                  <span className="font-mono-tabular text-slate-400">
                    {sceneSettings.toneMappingExposure.toFixed(2)}
                  </span>
                </div>
                <input
                  id="scene-exposure"
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.05"
                  value={sceneSettings.toneMappingExposure}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      toneMappingExposure: Number(e.target.value),
                    })
                  }
                  className="w-full studio-range"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <label htmlFor="scene-ambient" className="text-slate-300">
                    Заполняющий свет
                  </label>
                  <span className="font-mono-tabular text-slate-400">
                    {sceneSettings.ambientIntensity.toFixed(2)}
                  </span>
                </div>
                <input
                  id="scene-ambient"
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={sceneSettings.ambientIntensity}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      ambientIntensity: Number(e.target.value),
                    })
                  }
                  className="w-full studio-range"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <label htmlFor="scene-bounce" className="text-slate-300">
                    Отскок света (GI)
                  </label>
                  <span className="font-mono-tabular text-slate-400">
                    {(sceneSettings.bounceIntensity ?? 0.55).toFixed(2)}
                  </span>
                </div>
                <input
                  id="scene-bounce"
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={sceneSettings.bounceIntensity ?? 0.55}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      bounceIntensity: Number(e.target.value),
                    })
                  }
                  className="w-full studio-range"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={sceneSettings.fogEnabled}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      fogEnabled: e.target.checked,
                    })
                  }
                  className="accent-[#3B82F6] w-3.5 h-3.5"
                />
                <span>Экспоненциальный туман</span>
              </label>

              {sceneSettings.fogEnabled && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label htmlFor="scene-fog-density" className="text-slate-400">
                      Плотность тумана
                    </label>
                    <span className="font-mono-tabular text-slate-400">
                      {sceneSettings.fogDensity.toFixed(3)}
                    </span>
                  </div>
                  <input
                    id="scene-fog-density"
                    type="range"
                    min="0.002"
                    max="0.06"
                    step="0.002"
                    value={sceneSettings.fogDensity}
                    onChange={(e) =>
                      onUpdateSceneSettings({
                        ...sceneSettings,
                        fogDensity: Number(e.target.value),
                      })
                    }
                    className="w-full studio-range"
                  />
                </div>
              )}
            </section>

            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-slate-200">Вспомогательные элементы</h3>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sceneSettings.gridVisible}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      gridVisible: e.target.checked,
                    })
                  }
                  className="accent-[#3B82F6] w-3.5 h-3.5"
                />
                <span>Показывать сетку координат</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sceneSettings.axesVisible}
                  onChange={(e) =>
                    onUpdateSceneSettings({
                      ...sceneSettings,
                      axesVisible: e.target.checked,
                    })
                  }
                  className="accent-[#3B82F6] w-3.5 h-3.5"
                />
                <span>Показывать оси XYZ</span>
              </label>

              <button
                type="button"
                onClick={onResetCamera}
                className="w-full mt-2 py-2 px-3 rounded-md bg-[#1B1F26] hover:bg-[#242A34] border border-white/10 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
              >
                Сбросить положение камеры
              </button>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
};
