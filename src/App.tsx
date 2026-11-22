import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Aperture, Box, PanelLeft, PanelRight, Upload, X } from 'lucide-react';
import { InspectorPanel } from './components/InspectorPanel';
import { OutlinerPanel } from './components/OutlinerPanel';
import { ProjectsModal } from './components/ProjectsModal';
import { TopToolbar } from './components/TopToolbar';
import {
  buildExportableProjectJson,
  deleteProjectSlot,
  listProjectSlots,
  loadAssetBuffer,
  loadAutoProject,
  loadProjectSlot,
  restoreEmbeddedAssetsToStorage,
  saveAssetBuffer,
  saveAutoProject,
  saveProjectSlot,
} from './editor/assetStorage';
import {
  classifySceneLights,
  createEmptyProject,
  createGlbNode,
  createId,
  createLightNode,
  createPrimitiveNode,
  createStarterProject,
  deserializeProject,
  duplicateNode,
} from './editor/sceneModel';
import { ThreeViewportEngine } from './editor/threeEngine';
import { createInitialDenoiserStatus } from './editor/oidnDenoiser';
import type {
  CameraState,
  DenoiserStatus,
  DenoiserViewMode,
  LightKind,
  LightProps,
  MaterialProps,
  PathTracerStatus,
  PrimitiveType,
  SavedProjectMeta,
  SceneNode,
  SceneProjectV1,
  SceneSettings,
  TransformMode,
  TransformProps,
  TransformSpace,
  ViewportShadingMode,
} from './editor/types';

export default function App() {
  const [initialProject] = useState<SceneProjectV1>(() => loadAutoProject() ?? createStarterProject());
  const [project, setProject] = useState<SceneProjectV1>(initialProject);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    () =>
      initialProject.nodes.find((n) => n.primitiveType === 'torusKnot')?.id ??
      initialProject.nodes.find((n) => n.kind === 'primitive')?.id ??
      null,
  );
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [transformSpace, setTransformSpace] = useState<TransformSpace>('world');
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportShadingMode>('render');

  const [projectsOpen, setProjectsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProjectMeta[]>(() => listProjectSlots());
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isImportingGlb, setIsImportingGlb] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [pathTracerStatus, setPathTracerStatus] = useState<PathTracerStatus>(() => ({
    phase: 'idle',
    samples: 0,
    maxSamples: initialProject.settings.pathTracer?.maxSamples ?? 128,
  }));
  const [denoiserStatus, setDenoiserStatus] = useState<DenoiserStatus>(() =>
    createInitialDenoiserStatus(),
  );

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<ThreeViewportEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounterRef = useRef(0);

  const selectedNode = project.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const lightStatus = useMemo(() => classifySceneLights(project.nodes), [project.nodes]);

  // Keep latest callbacks in ref so Three.js engine mounts once and never resets
  const engineCallbacksRef = useRef({
    onSelectNode: (id: string | null) => {
      setSelectedNodeId(id);
    },
    onTransformNode: (id: string, transform: TransformProps) => {
      setProject((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? { ...n, transform } : n)),
      }));
    },
    onCameraChange: (camera: CameraState) => {
      setProject((prev) => ({ ...prev, camera }));
    },
    onPathTracerStatusChange: (status: PathTracerStatus) => {
      setPathTracerStatus(status);
    },
    onDenoiserStatusChange: (status: DenoiserStatus) => {
      setDenoiserStatus(status);
    },
  });

  const mountProjectIntoEngine = useCallback(async (proj: SceneProjectV1, selectFirst = true) => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.clearAllNodes();
    engine.applySceneSettings(proj.settings);
    engine.setCameraState(proj.camera);

    for (const node of proj.nodes) {
      if (node.kind === 'primitive') {
        engine.addOrUpdatePrimitiveNode(node);
      } else if (node.kind === 'light') {
        engine.addOrUpdateLightNode(node);
      } else if (node.kind === 'glb' && node.assetId) {
        const buffer = await loadAssetBuffer(node.assetId);
        if (buffer) {
          try {
            await engine.parseAndMountGlb(node, buffer, false);
          } catch (err) {
            console.warn('Не удалось восстановить GLB-модель:', node.name, err);
          }
        }
      }
    }

    const firstId = selectFirst
      ? (proj.nodes.find((n) => n.primitiveType === 'torusKnot')?.id ??
          proj.nodes.find((n) => n.kind !== 'light')?.id ??
          proj.nodes[0]?.id ??
          null)
      : null;
    setSelectedNodeId(firstId);
    engine.selectNode(firstId);
  }, []);

  // Initialize WebGL viewport once
  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new ThreeViewportEngine(mountEl, initialProject.settings, {
      onSelectNode: (id) => engineCallbacksRef.current.onSelectNode(id),
      onTransformNode: (id, transform) => engineCallbacksRef.current.onTransformNode(id, transform),
      onCameraChange: (cam) => engineCallbacksRef.current.onCameraChange(cam),
      onContextLostChange: (lost) => setContextLost(lost),
      onPathTracerStatusChange: (status) => engineCallbacksRef.current.onPathTracerStatusChange(status),
      onDenoiserStatusChange: (status) => engineCallbacksRef.current.onDenoiserStatusChange(status),
    });

    engineRef.current = engine;
    void mountProjectIntoEngine(initialProject, true);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [initialProject, mountProjectIntoEngine]);

  // Sync selection & gizmo modes to Three.js engine
  useEffect(() => {
    engineRef.current?.selectNode(selectedNodeId);
  }, [selectedNodeId]);

  useEffect(() => {
    engineRef.current?.setTransformMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    engineRef.current?.setTransformSpace(transformSpace);
  }, [transformSpace]);

  useEffect(() => {
    engineRef.current?.setSnapEnabled(snapEnabled);
  }, [snapEnabled]);

  useEffect(() => {
    engineRef.current?.setShadingState(viewportMode, lightStatus, project.settings);
  }, [viewportMode, lightStatus, project.settings]);

  // Debounced auto-save to localStorage
  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveAutoProject(project);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [project]);

  const showSaveBadge = useCallback((text: string) => {
    setSaveFeedback(text);
    window.setTimeout(() => {
      setSaveFeedback((curr) => (curr === text ? null : curr));
    }, 2200);
  }, []);

  // Actions: Add Primitives & Lights
  const handleAddPrimitive = useCallback((type: PrimitiveType) => {
    const node = createPrimitiveNode(type);
    setProject((prev) => ({
      ...prev,
      nodes: [...prev.nodes, node],
    }));
    engineRef.current?.addOrUpdatePrimitiveNode(node);
    setSelectedNodeId(node.id);
    setTransformMode((m) => (m === 'select' ? 'translate' : m));
  }, []);

  const handleAddLight = useCallback((kind: LightKind) => {
    const node = createLightNode(kind);
    setProject((prev) => ({
      ...prev,
      nodes: [...prev.nodes, node],
    }));
    engineRef.current?.addOrUpdateLightNode(node);
    setSelectedNodeId(node.id);
  }, []);

  // Actions: Node Manipulation
  const handleUpdateNodeName = useCallback((id: string, name: string) => {
    setProject((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
    }));
  }, []);

  const handleUpdateTransform = useCallback((id: string, transform: TransformProps) => {
    setProject((prev) => {
      const target = prev.nodes.find((n) => n.id === id);
      if (!target) return prev;
      const updated = { ...target, transform };
      if (updated.kind === 'primitive') engineRef.current?.addOrUpdatePrimitiveNode(updated);
      else if (updated.kind === 'light') engineRef.current?.addOrUpdateLightNode(updated);
      else if (updated.kind === 'glb') engineRef.current?.updateGlbNodeProperties(updated);

      return {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? updated : n)),
      };
    });
  }, []);

  const handleUpdateMaterial = useCallback((id: string, material: MaterialProps) => {
    setProject((prev) => {
      const target = prev.nodes.find((n) => n.id === id);
      if (!target) return prev;
      const updated = { ...target, material };
      if (updated.kind === 'primitive') engineRef.current?.addOrUpdatePrimitiveNode(updated);
      else if (updated.kind === 'glb') engineRef.current?.updateGlbNodeProperties(updated);

      return {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? updated : n)),
      };
    });
  }, []);

  const handleUpdateLight = useCallback((id: string, light: LightProps) => {
    setProject((prev) => {
      const target = prev.nodes.find((n) => n.id === id);
      if (!target) return prev;
      const updated = { ...target, light };
      engineRef.current?.addOrUpdateLightNode(updated);
      return {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? updated : n)),
      };
    });
  }, []);

  const handleUpdateNodeFlags = useCallback(
    (id: string, flags: Partial<Pick<SceneNode, 'visible' | 'castShadow' | 'receiveShadow'>>) => {
      setProject((prev) => {
        const target = prev.nodes.find((n) => n.id === id);
        if (!target) return prev;
        const updated = { ...target, ...flags };
        if (updated.kind === 'primitive') engineRef.current?.addOrUpdatePrimitiveNode(updated);
        else if (updated.kind === 'light') engineRef.current?.addOrUpdateLightNode(updated);
        else if (updated.kind === 'glb') engineRef.current?.updateGlbNodeProperties(updated);

        return {
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === id ? updated : n)),
        };
      });
    },
    [],
  );

  const handleToggleVisibility = useCallback((id: string) => {
    setProject((prev) => {
      const target = prev.nodes.find((n) => n.id === id);
      if (!target) return prev;
      const updated = { ...target, visible: !target.visible };
      if (updated.kind === 'primitive') engineRef.current?.addOrUpdatePrimitiveNode(updated);
      else if (updated.kind === 'light') engineRef.current?.addOrUpdateLightNode(updated);
      else if (updated.kind === 'glb') engineRef.current?.updateGlbNodeProperties(updated);

      return {
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === id ? updated : n)),
      };
    });
  }, []);

  const handleDuplicateNode = useCallback(
    async (id: string) => {
      const original = project.nodes.find((n) => n.id === id);
      if (!original) return;
      const copy = duplicateNode(original);

      setProject((prev) => ({
        ...prev,
        nodes: [...prev.nodes, copy],
      }));

      if (copy.kind === 'primitive') {
        engineRef.current?.addOrUpdatePrimitiveNode(copy);
      } else if (copy.kind === 'light') {
        engineRef.current?.addOrUpdateLightNode(copy);
      } else if (copy.kind === 'glb' && copy.assetId) {
        const buf = await loadAssetBuffer(copy.assetId);
        if (buf && engineRef.current) {
          await engineRef.current.parseAndMountGlb(copy, buf, false);
        }
      }
      setSelectedNodeId(copy.id);
    },
    [project.nodes],
  );

  const handleDeleteNode = useCallback(
    (id: string) => {
      engineRef.current?.removeNode(id);
      setProject((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== id),
      }));
      if (selectedNodeId === id) {
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId],
  );

  const handleGroundNode = useCallback((id: string) => {
    const newTransform = engineRef.current?.groundNodeToFloor(id);
    if (!newTransform) return;
    setProject((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, transform: newTransform } : n)),
    }));
  }, []);

  const handleFocusNode = useCallback((id: string | null) => {
    engineRef.current?.focusOnNode(id);
  }, []);

  const handleUpdateSceneSettings = useCallback((settings: SceneSettings) => {
    setProject((prev) => ({ ...prev, settings }));
    engineRef.current?.applySceneSettings(settings);
  }, []);

  const handleResetPathTracer = useCallback(() => {
    engineRef.current?.resetPathTracer();
  }, []);

  const handleChangeDenoiserViewMode = useCallback((mode: DenoiserViewMode) => {
    engineRef.current?.setDenoiserViewMode(mode);
  }, []);

  const handleResetCamera = useCallback(() => {
    const defaultCam: CameraState = {
      position: { x: 5.2, y: 3.8, z: 6.4 },
      target: { x: 0, y: 0.8, z: 0 },
    };
    engineRef.current?.setCameraState(defaultCam);
    setProject((prev) => ({ ...prev, camera: defaultCam }));
  }, []);

  // File Import (.glb / .gltf / .json)
  const handleFilesImport = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      setErrorBanner(null);

      for (const file of list) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.json')) {
          try {
            const text = await file.text();
            const imported = deserializeProject(text);
            await restoreEmbeddedAssetsToStorage(imported);
            setProject(imported);
            await mountProjectIntoEngine(imported, true);
            showSaveBadge('Проект импортирован');
          } catch (err) {
            setErrorBanner(err instanceof Error ? err.message : 'Ошибка импорта JSON проекта.');
          }
        } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
          setIsImportingGlb(true);
          try {
            const buffer = await file.arrayBuffer();
            const assetId = createId('glb_asset');
            await saveAssetBuffer(assetId, buffer);

            const placeholderNode = createGlbNode(assetId, {
              fileName: file.name,
              fileSizeBytes: buffer.byteLength,
              meshCount: 0,
              triangleCount: 0,
            });

            if (engineRef.current) {
              const meta = await engineRef.current.parseAndMountGlb(placeholderNode, buffer, true);
              const finalNode: SceneNode = { ...placeholderNode, glbMeta: meta };

              setProject((prev) => ({
                ...prev,
                nodes: [...prev.nodes, finalNode],
              }));
              setSelectedNodeId(finalNode.id);
              setTransformMode((m) => (m === 'select' ? 'translate' : m));
              showSaveBadge(`Импортировано: ${file.name}`);
            }
          } catch (err) {
            setErrorBanner(
              err instanceof Error
                ? `Не удалось загрузить ${file.name}: ${err.message}`
                : `Ошибка при чтении модели ${file.name}.`,
            );
          } finally {
            setIsImportingGlb(false);
          }
        } else {
          setErrorBanner(`Формат файла «${file.name}» не поддерживается. Используйте .glb, .gltf или .json.`);
        }
      }
    },
    [mountProjectIntoEngine, showSaveBadge],
  );

  // Drag-and-Drop handlers over viewport
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFile(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesImport(e.dataTransfer.files);
    }
  };

  // Persistence & Export actions
  const handleSaveLocal = useCallback(() => {
    saveAutoProject(project);
    saveProjectSlot(project);
    setSavedProjects(listProjectSlots());
    showSaveBadge('Сохранено');
  }, [project, showSaveBadge]);

  const handleExportJson = useCallback(async () => {
    try {
      const json = await buildExportableProjectJson(project);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (project.name || 'scene').replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, '_');
      link.href = url;
      link.download = `${safeName}.json`;
      link.click();
      URL.revokeObjectURL(url);
      showSaveBadge('JSON выгружен');
    } catch {
      setErrorBanner('Не удалось экспортировать JSON-файл проекта.');
    }
  }, [project, showSaveBadge]);

  const handleExportPng = useCallback(() => {
    if (!engineRef.current) return;
    const dataUrl = engineRef.current.exportSnapshotPng();
    const link = document.createElement('a');
    const safeName = (project.name || 'render').replace(/[^a-zA-Zа-яА-Я0-9_-]+/g, '_');
    link.href = dataUrl;
    link.download = `${safeName}.png`;
    link.click();
  }, [project.name]);

  const handleLoadSlot = useCallback(
    async (projectId: string) => {
      const loaded = loadProjectSlot(projectId);
      if (!loaded) return;
      setProject(loaded);
      await mountProjectIntoEngine(loaded, true);
      setProjectsOpen(false);
      showSaveBadge('Проект загружен');
    },
    [mountProjectIntoEngine, showSaveBadge],
  );

  const handleDeleteSlot = useCallback((projectId: string) => {
    deleteProjectSlot(projectId);
    setSavedProjects(listProjectSlots());
  }, []);

  const handleLoadStarter = useCallback(async () => {
    const starter = createStarterProject();
    setProject(starter);
    await mountProjectIntoEngine(starter, true);
    setProjectsOpen(false);
  }, [mountProjectIntoEngine]);

  const handleCreateEmpty = useCallback(async () => {
    const empty = createEmptyProject();
    setProject(empty);
    await mountProjectIntoEngine(empty, false);
    setProjectsOpen(false);
  }, [mountProjectIntoEngine]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'q') setTransformMode('select');
      else if (key === 'w') setTransformMode('translate');
      else if (key === 'e') setTransformMode('rotate');
      else if (key === 'r') setTransformMode('scale');
      else if (key === 'f') {
        e.preventDefault();
        handleFocusNode(selectedNodeId);
      } else if (key === 'h') {
        setZenMode((z) => !z);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) {
          e.preventDefault();
          handleDeleteNode(selectedNodeId);
        }
      } else if (e.key === 'Escape') {
        if (projectsOpen) setProjectsOpen(false);
        else setSelectedNodeId(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteNode, handleFocusNode, projectsOpen, selectedNodeId]);

  return (
    <div
      className="h-screen w-screen flex flex-col bg-[#111317] text-[#E5E7EB] overflow-hidden"
      data-selected-node={selectedNode?.id ?? ''}
      data-transform-mode={transformMode}
      data-viewport-mode={viewportMode}
      data-render-engine={project.settings.renderEngine}
      data-pt-phase={pathTracerStatus.phase}
      data-pt-samples={pathTracerStatus.samples}
      data-denoiser-phase={denoiserStatus.phase}
      data-denoiser-view={denoiserStatus.viewMode}
      data-pitch-black={viewportMode === 'render' && !lightStatus.hasAny ? 'true' : 'false'}
      data-dark-render={viewportMode === 'render' && !lightStatus.hasDirectional ? 'true' : 'false'}
    >
      <TopToolbar
        projectName={project.name}
        onProjectNameChange={(name) => setProject((prev) => ({ ...prev, name }))}
        transformMode={transformMode}
        onTransformModeChange={setTransformMode}
        transformSpace={transformSpace}
        onTransformSpaceToggle={() => setTransformSpace((s) => (s === 'world' ? 'local' : 'world'))}
        snapEnabled={snapEnabled}
        onSnapToggle={() => setSnapEnabled((s) => !s)}
        gridVisible={project.settings.gridVisible}
        onGridToggle={() =>
          handleUpdateSceneSettings({
            ...project.settings,
            gridVisible: !project.settings.gridVisible,
          })
        }
        hasSelection={Boolean(selectedNodeId)}
        onFocusSelected={() => handleFocusNode(selectedNodeId)}
        zenMode={zenMode}
        onZenModeToggle={() => setZenMode((z) => !z)}
        onOpenProjects={() => {
          setSavedProjects(listProjectSlots());
          setProjectsOpen(true);
        }}
        onImportClick={() => fileInputRef.current?.click()}
        onExportJson={() => void handleExportJson()}
        onExportPng={handleExportPng}
        onSaveLocal={handleSaveLocal}
        saveFeedback={saveFeedback}
      />

      {/* Hidden File Input for .GLB / .GLTF / .JSON */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf,.json"
        multiple
        className="hidden"
        aria-label="Выбрать файл модели или проекта"
        onChange={(e) => {
          if (e.target.files) {
            void handleFilesImport(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Main Studio Workbench */}
      <div className="flex-1 flex min-h-0 relative">
        {!zenMode && (
          <OutlinerPanel
            nodes={project.nodes}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onAddPrimitive={handleAddPrimitive}
            onAddLight={handleAddLight}
            onImportGlbClick={() => fileInputRef.current?.click()}
            onToggleVisibility={handleToggleVisibility}
            onDuplicateNode={(id) => void handleDuplicateNode(id)}
            onDeleteNode={handleDeleteNode}
          />
        )}

        {/* Central 3D Viewport */}
        <main
          className="flex-1 relative min-w-0 h-full bg-[#13161c]"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div ref={canvasMountRef} className="w-full h-full" />

          {/* Error Notification */}
          {errorBanner && (
            <div
              role="alert"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 rounded-md bg-red-950/95 border border-red-500/40 text-xs text-red-200 shadow-lg max-w-md"
            >
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="flex-1">{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Скрыть ошибку"
                className="p-0.5 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* WebGL Context Lost Banner */}
          {contextLost && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#111317]/95">
              <div className="p-5 rounded-lg bg-[#16191E] border border-white/15 text-center space-y-2 max-w-sm">
                <div className="text-sm font-semibold text-white">Контекст WebGL приостановлен</div>
                <p className="text-xs text-slate-400">
                  Браузер временно освободил графический контекст. Обновите страницу или дождитесь восстановления.
                </p>
              </div>
            </div>
          )}

          {/* Drag & Drop GLB Overlay */}
          {isDraggingFile && (
            <div className="absolute inset-3 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-[#3B82F6] bg-[#111317]/90 pointer-events-none">
              <div className="text-center space-y-2 px-6">
                <Upload className="w-8 h-8 text-[#3B82F6] mx-auto" />
                <div className="text-sm font-semibold text-white">
                  Отпустите файл для импорта на сцену
                </div>
                <div className="text-xs text-slate-400">
                  Поддерживаются 3D-модели (.glb, .gltf) и файлы проектов (.json)
                </div>
              </div>
            </div>
          )}

          {/* Viewport Shading Mode Switcher (Top-Right) */}
          <div
            role="group"
            aria-label="Режим отображения сцены"
            className="absolute top-3 right-3 z-20 flex items-center gap-0.5 p-0.5 rounded-md bg-[#16191E] border border-white/15"
          >
            <button
              type="button"
              onClick={() => setViewportMode('objects')}
              aria-label="Только объекты"
              aria-pressed={viewportMode === 'objects'}
              title="Только объекты (без учёта источников света)"
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                viewportMode === 'objects'
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Box className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewportMode('render')}
              aria-label="Рендер"
              aria-pressed={viewportMode === 'render'}
              title="Рендер (объекты, свет и тени)"
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                viewportMode === 'render'
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Aperture className="w-4 h-4" />
            </button>
          </div>

          {/* Loading GLB Indicator */}
          {isImportingGlb && (
            <div className="absolute top-14 right-3 z-20 px-3 py-1.5 rounded-md bg-[#16191E] border border-white/15 text-xs text-slate-200">
              Загрузка .GLB модели...
            </div>
          )}

          {/* Restore Panels button when Zen Mode is active */}
          {zenMode && (
            <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none z-10">
              <button
                type="button"
                onClick={() => setZenMode(false)}
                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#16191E]/95 border border-white/15 text-xs font-medium text-slate-200 hover:text-white cursor-pointer"
              >
                <PanelLeft className="w-3.5 h-3.5" />
                <span>Показать панели (H)</span>
              </button>
              <button
                type="button"
                onClick={() => setZenMode(false)}
                className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#16191E]/95 border border-white/15 text-xs font-medium text-slate-200 hover:text-white cursor-pointer"
              >
                <PanelRight className="w-3.5 h-3.5" />
                <span>Инспектор</span>
              </button>
            </div>
          )}

          {/* Compact Bottom Viewport Hint Strip */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-md bg-[#16191E]/95 border border-white/10 text-[11px] text-slate-400 whitespace-nowrap">
            <span>ЛКМ: Выбор / Орбита</span>
            <span aria-hidden="true">·</span>
            <span>ПКМ: Панорама</span>
            <span aria-hidden="true">·</span>
            <span>Колесо: Зум</span>
            <span aria-hidden="true">·</span>
            <span>Q/W/E/R: Гизмо</span>
            <span aria-hidden="true">·</span>
            <span>Перетащите .glb на сцену</span>
          </div>
        </main>

        {!zenMode && (
          <InspectorPanel
            selectedNode={selectedNode}
            sceneSettings={project.settings}
            pathTracerStatus={pathTracerStatus}
            denoiserStatus={denoiserStatus}
            onUpdateNodeName={handleUpdateNodeName}
            onUpdateTransform={handleUpdateTransform}
            onUpdateMaterial={handleUpdateMaterial}
            onUpdateLight={handleUpdateLight}
            onUpdateNodeFlags={handleUpdateNodeFlags}
            onGroundNode={handleGroundNode}
            onFocusNode={(id) => handleFocusNode(id)}
            onDuplicateNode={(id) => void handleDuplicateNode(id)}
            onDeleteNode={handleDeleteNode}
            onUpdateSceneSettings={handleUpdateSceneSettings}
            onResetPathTracer={handleResetPathTracer}
            onChangeDenoiserViewMode={handleChangeDenoiserViewMode}
            onResetCamera={handleResetCamera}
          />
        )}
      </div>

      <ProjectsModal
        open={projectsOpen}
        currentProjectName={project.name}
        savedProjects={savedProjects}
        onClose={() => setProjectsOpen(false)}
        onSaveCurrentSlot={handleSaveLocal}
        onLoadSlot={(id) => void handleLoadSlot(id)}
        onDeleteSlot={handleDeleteSlot}
        onLoadStarter={() => void handleLoadStarter()}
        onCreateEmpty={() => void handleCreateEmpty()}
      />
    </div>
  );
}
