import type {
  GlbMetadata,
  LightKind,
  LightProps,
  MaterialProps,
  PathTracerSettings,
  PrimitiveType,
  SceneNode,
  SceneProjectV1,
  SceneSettings,
  TransformProps,
  Vec3Tuple,
  ViewportShadingMode,
} from './types';

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  box: 'Куб',
  sphere: 'Сфера',
  cylinder: 'Цилиндр',
  cone: 'Конус',
  torus: 'Тор',
  torusKnot: 'Узел тора',
  icosahedron: 'Икосаэдр',
  capsule: 'Капсула',
  plane: 'Плоскость',
};

export const LIGHT_LABELS: Record<LightKind, string> = {
  directional: 'Направленный свет',
  point: 'Точечный свет',
  spot: 'Прожектор',
};

export function createId(prefix = 'node'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return `${prefix}_${time}_${rand}`;
}

export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function roundTo(val: number, decimals = 3): number {
  if (!Number.isFinite(val)) return 0;
  const factor = Math.pow(10, decimals);
  const res = Math.round(val * factor) / factor;
  return Object.is(res, -0) ? 0 : res;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function snapValue(val: number, step: number): number {
  if (step <= 0 || !Number.isFinite(step)) return val;
  return roundTo(Math.round(val / step) * step, 4);
}

export function createDefaultTransform(partial?: {
  position?: Partial<Vec3Tuple>;
  rotationDeg?: Partial<Vec3Tuple>;
  scale?: Partial<Vec3Tuple>;
}): TransformProps {
  return {
    position: { x: 0, y: 0.5, z: 0, ...(partial?.position ?? {}) },
    rotationDeg: { x: 0, y: 0, z: 0, ...(partial?.rotationDeg ?? {}) },
    scale: { x: 1, y: 1, z: 1, ...(partial?.scale ?? {}) },
  };
}

export function createDefaultMaterial(partial?: Partial<MaterialProps>): MaterialProps {
  return {
    color: '#64748b',
    roughness: 0.42,
    metalness: 0.15,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    transparent: false,
    wireframe: false,
    flatShading: false,
    overrideGlbMaterial: false,
    ...partial,
  };
}

export function createDefaultLightProps(kind: LightKind, partial?: Partial<LightProps>): LightProps {
  const base: LightProps = {
    lightKind: kind,
    color: kind === 'directional' ? '#fff4e6' : '#ffffff',
    intensity: kind === 'directional' ? 2.4 : kind === 'point' ? 20 : 34,
    distance: kind === 'directional' ? 0 : kind === 'point' ? 5.5 : 6,
    decay: 2,
    angleDeg: 35,
    penumbra: 0.45,
    castShadow: true,
    shadowIntensity: 1,
  };
  return {
    ...base,
    ...partial,
    shadowIntensity: clamp(partial?.shadowIntensity ?? base.shadowIntensity, 0, 1),
  };
}

export function createDefaultPathTracerSettings(
  partial?: Partial<PathTracerSettings>,
): PathTracerSettings {
  const base: PathTracerSettings = {
    bounces: 5,
    maxSamples: 128,
    renderScale: 0.75,
    paused: false,
  };
  return {
    bounces: Math.round(clamp(partial?.bounces ?? base.bounces, 1, 12)),
    maxSamples: Math.round(clamp(partial?.maxSamples ?? base.maxSamples, 8, 512)),
    renderScale: roundTo(clamp(partial?.renderScale ?? base.renderScale, 0.25, 1), 2),
    paused: Boolean(partial?.paused ?? base.paused),
  };
}

export function createDefaultSceneSettings(partial?: Partial<SceneSettings>): SceneSettings {
  const base: SceneSettings = {
    backgroundColor: '#1a1f29',
    gridVisible: true,
    axesVisible: false,
    fogEnabled: true,
    fogColor: '#1a1f29',
    fogDensity: 0.016,
    ambientIntensity: 0.35,
    bounceIntensity: 0.55,
    toneMappingExposure: 1.1,
    renderEngine: 'standard',
    pathTracer: createDefaultPathTracerSettings(),
  };
  return {
    ...base,
    ...partial,
    bounceIntensity: clamp(partial?.bounceIntensity ?? base.bounceIntensity, 0, 1.5),
    renderEngine: partial?.renderEngine === 'pathtracer' ? 'pathtracer' : 'standard',
    pathTracer: createDefaultPathTracerSettings(partial?.pathTracer),
  };
}

export function getPrimitiveDefaultY(type: PrimitiveType): number {
  switch (type) {
    case 'plane':
      return 0.01;
    case 'torus':
    case 'torusKnot':
      return 0.7;
    case 'cylinder':
    case 'cone':
    case 'capsule':
      return 0.75;
    default:
      return 0.5;
  }
}

export function createPrimitiveNode(
  primitiveType: PrimitiveType,
  options?: {
    name?: string;
    position?: Partial<Vec3Tuple>;
    rotationDeg?: Partial<Vec3Tuple>;
    scale?: Partial<Vec3Tuple>;
    material?: Partial<MaterialProps>;
  },
): SceneNode {
  const defaultY = getPrimitiveDefaultY(primitiveType);
  return {
    id: createId('mesh'),
    name: options?.name ?? PRIMITIVE_LABELS[primitiveType],
    kind: 'primitive',
    visible: true,
    castShadow: primitiveType !== 'plane',
    receiveShadow: true,
    primitiveType,
    transform: createDefaultTransform({
      position: { x: 0, y: defaultY, z: 0, ...(options?.position ?? {}) },
      rotationDeg: options?.rotationDeg,
      scale: options?.scale,
    }),
    material: createDefaultMaterial(options?.material),
  };
}

export function createLightNode(
  lightKind: LightKind,
  options?: {
    name?: string;
    position?: Partial<Vec3Tuple>;
    light?: Partial<LightProps>;
  },
): SceneNode {
  const defaultPos =
    lightKind === 'directional'
      ? { x: 5, y: 8, z: 5 }
      : lightKind === 'spot'
        ? { x: 0, y: 4.2, z: 0 }
        : { x: 1.4, y: 2.6, z: 1.4 };

  return {
    id: createId('light'),
    name: options?.name ?? LIGHT_LABELS[lightKind],
    kind: 'light',
    visible: true,
    castShadow: true,
    receiveShadow: false,
    transform: createDefaultTransform({
      position: {
        ...defaultPos,
        ...(options?.position ?? {}),
      },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    light: createDefaultLightProps(lightKind, options?.light),
  };
}

export function createGlbNode(
  assetId: string,
  meta: GlbMetadata,
  options?: {
    name?: string;
    position?: Partial<Vec3Tuple>;
  },
): SceneNode {
  const baseName = meta.fileName.replace(/\.(glb|gltf)$/i, '') || 'Модель GLB';
  return {
    id: createId('glb'),
    name: options?.name ?? baseName,
    kind: 'glb',
    visible: true,
    castShadow: true,
    receiveShadow: true,
    assetId,
    glbMeta: meta,
    transform: createDefaultTransform({
      position: { x: 0, y: 0, z: 0, ...(options?.position ?? {}) },
      rotationDeg: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }),
    material: createDefaultMaterial({
      color: '#cbd5e1',
      roughness: 0.45,
      metalness: 0.2,
      overrideGlbMaterial: false,
    }),
  };
}

export function duplicateNode(node: SceneNode): SceneNode {
  const copy: SceneNode = JSON.parse(JSON.stringify(node));
  copy.id = createId(node.kind === 'light' ? 'light' : node.kind === 'glb' ? 'glb' : 'mesh');
  copy.name = `${node.name} (копия)`;
  copy.transform.position.x = roundTo(copy.transform.position.x + 1.2, 3);
  return copy;
}

export function createStarterProject(): SceneProjectV1 {
  const keyLight = createLightNode('directional', {
    name: 'Ключевой свет',
    position: { x: 5.5, y: 8.5, z: 4.5 },
    light: { color: '#fff3e0', intensity: 2.6, castShadow: true },
  });

  const rimLight = createLightNode('point', {
    name: 'Контровой свет',
    position: { x: -4.2, y: 3.6, z: -3.5 },
    light: { color: '#60a5fa', intensity: 22, distance: 20, castShadow: false },
  });

  const plinth = createPrimitiveNode('cylinder', {
    name: 'Подиум',
    position: { x: 0, y: 0.15, z: 0 },
    scale: { x: 2.2, y: 0.3, z: 2.2 },
    material: {
      color: '#252a34',
      roughness: 0.72,
      metalness: 0.15,
    },
  });

  const heroKnot = createPrimitiveNode('torusKnot', {
    name: 'Скульптура тора',
    position: { x: 0, y: 1.35, z: 0 },
    rotationDeg: { x: 12, y: 28, z: 0 },
    scale: { x: 0.75, y: 0.75, z: 0.75 },
    material: {
      color: '#d97706',
      roughness: 0.2,
      metalness: 0.9,
    },
  });

  const accentSphere = createPrimitiveNode('sphere', {
    name: 'Матовая сфера',
    position: { x: -1.85, y: 0.55, z: 0.85 },
    scale: { x: 0.55, y: 0.55, z: 0.55 },
    material: {
      color: '#3b82f6',
      roughness: 0.35,
      metalness: 0.1,
    },
  });

  const accentPrism = createPrimitiveNode('icosahedron', {
    name: 'Кристалл',
    position: { x: 1.75, y: 0.65, z: -0.65 },
    rotationDeg: { x: 18, y: 40, z: 10 },
    scale: { x: 0.65, y: 0.65, z: 0.65 },
    material: {
      color: '#10b981',
      roughness: 0.12,
      metalness: 0.75,
    },
  });

  return {
    version: 1,
    id: createId('proj'),
    name: 'Студийная сцена',
    updatedAt: new Date().toISOString(),
    settings: createDefaultSceneSettings(),
    camera: {
      position: { x: 5.2, y: 3.8, z: 6.4 },
      target: { x: 0, y: 0.8, z: 0 },
    },
    nodes: [plinth, heroKnot, accentSphere, accentPrism, keyLight, rimLight],
  };
}

export function createEmptyProject(name = 'Новая сцена'): SceneProjectV1 {
  return {
    version: 1,
    id: createId('proj'),
    name,
    updatedAt: new Date().toISOString(),
    settings: createDefaultSceneSettings(),
    camera: {
      position: { x: 5.5, y: 4, z: 6.5 },
      target: { x: 0, y: 0.5, z: 0 },
    },
    nodes: [
      createLightNode('directional', {
        name: 'Основной свет',
        position: { x: 5, y: 8, z: 5 },
      }),
    ],
  };
}

export function serializeProject(project: SceneProjectV1): string {
  const payload: SceneProjectV1 = {
    ...project,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function deserializeProject(rawJson: string): SceneProjectV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Некорректный JSON-файл проекта.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Неверная структура файла проекта.');
  }

  const obj = parsed as Partial<SceneProjectV1>;
  if (!Array.isArray(obj.nodes)) {
    throw new Error('В файле проекта отсутствует список объектов сцены (nodes).');
  }

  const normalizedNodes: SceneNode[] = obj.nodes
    .filter((n): n is SceneNode => Boolean(n && typeof n === 'object' && n.id && n.kind))
    .map((n) => ({
      id: String(n.id),
      name: String(n.name || 'Объект'),
      kind: n.kind,
      visible: n.visible !== false,
      castShadow: n.castShadow !== false,
      receiveShadow: n.receiveShadow !== false,
      transform: createDefaultTransform(n.transform),
      primitiveType: n.primitiveType,
      material: n.material ? createDefaultMaterial(n.material) : undefined,
      light: n.light ? createDefaultLightProps(n.light.lightKind ?? 'point', n.light) : undefined,
      assetId: n.assetId,
      glbMeta: n.glbMeta,
    }));

  return {
    version: 1,
    id: typeof obj.id === 'string' && obj.id ? obj.id : createId('proj'),
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Импортированный проект',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    settings: createDefaultSceneSettings(obj.settings),
    camera: {
      position: {
        x: obj.camera?.position?.x ?? 5.2,
        y: obj.camera?.position?.y ?? 3.8,
        z: obj.camera?.position?.z ?? 6.4,
      },
      target: {
        x: obj.camera?.target?.x ?? 0,
        y: obj.camera?.target?.y ?? 0.8,
        z: obj.camera?.target?.z ?? 0,
      },
    },
    nodes: normalizedNodes,
    embeddedAssets: obj.embeddedAssets,
  };
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface SceneLightStatus {
  hasAny: boolean;
  hasDirectional: boolean;
  hasLocalOnly: boolean;
  maxDirectionalIntensity: number;
}

export function classifySceneLights(nodes: SceneNode[]): SceneLightStatus {
  let hasAny = false;
  let hasDirectional = false;
  let maxDirectionalIntensity = 0;
  for (const node of nodes) {
    if (node.kind === 'light' && node.visible && (node.light?.intensity ?? 0) > 0) {
      hasAny = true;
      if (node.light?.lightKind === 'directional') {
        hasDirectional = true;
        maxDirectionalIntensity = Math.max(maxDirectionalIntensity, node.light.intensity);
      }
    }
  }
  return {
    hasAny,
    hasDirectional,
    hasLocalOnly: hasAny && !hasDirectional,
    maxDirectionalIntensity,
  };
}

export function hasActiveSceneLights(nodes: SceneNode[]): boolean {
  return classifySceneLights(nodes).hasAny;
}

export interface ResolvedViewportLighting {
  useWorkbenchLight: boolean;
  useEnvironment: boolean;
  environmentIntensity: number;
  ambientIntensity: number;
  bounceFillIntensity: number;
  backgroundColor: string;
  fogEnabled: boolean;
  gridVisible: boolean;
  shadowsEnabled: boolean;
  isPitchBlack: boolean;
  isDarkRender: boolean;
}

export function resolveViewportLighting(
  mode: ViewportShadingMode,
  lightStatus: SceneLightStatus | boolean,
  settings: SceneSettings,
): ResolvedViewportLighting {
  const status: SceneLightStatus =
    typeof lightStatus === 'boolean'
      ? {
          hasAny: lightStatus,
          hasDirectional: lightStatus,
          hasLocalOnly: false,
          maxDirectionalIntensity: lightStatus ? 2.4 : 0,
        }
      : lightStatus;

  if (mode === 'objects') {
    return {
      useWorkbenchLight: true,
      useEnvironment: true,
      environmentIntensity: 1,
      ambientIntensity: Math.max(0.85, settings.ambientIntensity),
      bounceFillIntensity: 0,
      backgroundColor: settings.backgroundColor,
      fogEnabled: settings.fogEnabled,
      gridVisible: settings.gridVisible,
      shadowsEnabled: false,
      isPitchBlack: false,
      isDarkRender: false,
    };
  }

  if (!status.hasAny) {
    return {
      useWorkbenchLight: false,
      useEnvironment: false,
      environmentIntensity: 0,
      ambientIntensity: 0,
      bounceFillIntensity: 0,
      backgroundColor: '#000000',
      fogEnabled: false,
      gridVisible: false,
      shadowsEnabled: true,
      isPitchBlack: true,
      isDarkRender: true,
    };
  }

  if (status.hasLocalOnly) {
    return {
      useWorkbenchLight: false,
      useEnvironment: false,
      environmentIntensity: 0,
      ambientIntensity: 0,
      bounceFillIntensity: 0,
      backgroundColor: '#000000',
      fogEnabled: false,
      gridVisible: false,
      shadowsEnabled: true,
      isPitchBlack: false,
      isDarkRender: true,
    };
  }

  // Directional Sun is active: scale ambient fill, IBL & counter-sun bounce light with Sun intensity
  // so shadow sides stay readable without raytracing while Sun=0 remains dark.
  const sunFactor = clamp(status.maxDirectionalIntensity / 2.4, 0, 1);
  const bounce = clamp(settings.bounceIntensity ?? 0.55, 0, 1.5);

  return {
    useWorkbenchLight: false,
    useEnvironment: sunFactor > 0,
    environmentIntensity: roundTo((0.22 + 0.55 * bounce) * sunFactor, 3),
    ambientIntensity: roundTo(settings.ambientIntensity * (0.35 + 0.85 * bounce) * sunFactor, 3),
    bounceFillIntensity: roundTo(0.65 * bounce * sunFactor, 3),
    backgroundColor: settings.backgroundColor,
    fogEnabled: settings.fogEnabled,
    gridVisible: settings.gridVisible,
    shadowsEnabled: true,
    isPitchBlack: false,
    isDarkRender: false,
  };
}

