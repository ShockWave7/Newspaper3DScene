export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'torusKnot'
  | 'icosahedron'
  | 'capsule'
  | 'plane';

export type LightKind = 'directional' | 'point' | 'spot';

export type NodeKind = 'primitive' | 'glb' | 'light';

export type TransformMode = 'select' | 'translate' | 'rotate' | 'scale';

export type TransformSpace = 'world' | 'local';

export type ViewportShadingMode = 'objects' | 'render';

export type RenderEngineMode = 'standard' | 'pathtracer';

export interface PathTracerSettings {
  bounces: number;
  maxSamples: number;
  renderScale: number;
  paused: boolean;
}

export interface PathTracerStatus {
  phase: 'idle' | 'preview' | 'tracing' | 'paused' | 'complete';
  samples: number;
  maxSamples: number;
}

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface TransformProps {
  position: Vec3Tuple;
  rotationDeg: Vec3Tuple;
  scale: Vec3Tuple;
}

export interface MaterialProps {
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  transparent: boolean;
  wireframe: boolean;
  flatShading: boolean;
  overrideGlbMaterial?: boolean;
}

export interface LightProps {
  lightKind: LightKind;
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  angleDeg: number;
  penumbra: number;
  castShadow: boolean;
  shadowIntensity: number;
}

export interface GlbMetadata {
  fileName: string;
  fileSizeBytes: number;
  meshCount: number;
  triangleCount: number;
  boundsSize?: Vec3Tuple;
}

export interface SceneNode {
  id: string;
  name: string;
  kind: NodeKind;
  visible: boolean;
  castShadow: boolean;
  receiveShadow: boolean;
  transform: TransformProps;
  primitiveType?: PrimitiveType;
  material?: MaterialProps;
  light?: LightProps;
  assetId?: string;
  glbMeta?: GlbMetadata;
}

export interface SceneSettings {
  backgroundColor: string;
  gridVisible: boolean;
  axesVisible: boolean;
  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  ambientIntensity: number;
  bounceIntensity: number;
  toneMappingExposure: number;
  renderEngine: RenderEngineMode;
  pathTracer: PathTracerSettings;
}

export interface CameraState {
  position: Vec3Tuple;
  target: Vec3Tuple;
}

export interface EmbeddedAssetMap {
  [assetId: string]: {
    fileName: string;
    base64: string;
  };
}

export interface SceneProjectV1 {
  version: 1;
  id: string;
  name: string;
  updatedAt: string;
  settings: SceneSettings;
  camera: CameraState;
  nodes: SceneNode[];
  embeddedAssets?: EmbeddedAssetMap;
}

export interface SavedProjectMeta {
  id: string;
  name: string;
  updatedAt: string;
  nodeCount: number;
}
