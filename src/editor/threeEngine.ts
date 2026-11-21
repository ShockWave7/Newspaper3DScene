import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ProceduralEquirectTexture, WebGLPathTracer } from 'three-gpu-pathtracer';
import { clamp, degToRad, radToDeg, resolveViewportLighting, roundTo, type SceneLightStatus } from './sceneModel';
import type {
  CameraState,
  GlbMetadata,
  LightProps,
  MaterialProps,
  PathTracerStatus,
  PrimitiveType,
  SceneNode,
  SceneSettings,
  TransformMode,
  TransformProps,
  TransformSpace,
  ViewportShadingMode,
} from './types';

function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

function createPrimitiveGeometry(type: PrimitiveType): THREE.BufferGeometry {
  switch (type) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 36, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1.5, 32);
    case 'cone':
      return new THREE.ConeGeometry(0.55, 1.4, 32);
    case 'torus':
      return new THREE.TorusGeometry(0.55, 0.2, 20, 48);
    case 'torusKnot':
      return new THREE.TorusKnotGeometry(0.45, 0.14, 100, 18);
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(0.6, 0);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.35, 0.8, 8, 20);
    case 'plane': {
      const geo = new THREE.PlaneGeometry(4, 4);
      geo.rotateX(-Math.PI / 2);
      return geo;
    }
  }
}

function createPointRangeGeometry(radius: number): THREE.BufferGeometry {
  const segments = 48;
  const positions: number[] = [];
  const pushCircle = (plane: 'xy' | 'xz' | 'yz') => {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.cos(a0) * radius;
      const s0 = Math.sin(a0) * radius;
      const c1 = Math.cos(a1) * radius;
      const s1 = Math.sin(a1) * radius;
      if (plane === 'xy') positions.push(c0, s0, 0, c1, s1, 0);
      else if (plane === 'xz') positions.push(c0, 0, s0, c1, 0, s1);
      else positions.push(0, c0, s0, 0, c1, s1);
    }
  };
  pushCircle('xy');
  pushCircle('xz');
  pushCircle('yz');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function createSpotConeGeometry(distance: number, angleDeg: number): THREE.BufferGeometry {
  const height = Math.max(0.5, distance);
  const halfAngle = degToRad(Math.min(88, Math.max(1, angleDeg)));
  const radius = Math.tan(halfAngle) * height;
  const segments = 32;
  const positions: number[] = [];

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(a0) * radius,
      -height,
      Math.sin(a0) * radius,
      Math.cos(a1) * radius,
      -height,
      Math.sin(a1) * radius,
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    positions.push(0, 0, 0, Math.cos(a) * radius, -height, Math.sin(a) * radius);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function createDirectionalArrowGeometry(): THREE.BufferGeometry {
  const positions: number[] = [
    0, 0, 0, 0, 0, 2.2,
    0, 0, 2.2, 0.18, 0, 1.85,
    0, 0, 2.2, -0.18, 0, 1.85,
    0, 0, 2.2, 0, 0.18, 1.85,
    0, 0, 2.2, 0, -0.18, 1.85,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

interface ReflectionProbe {
  cubeTarget: THREE.WebGLCubeRenderTarget;
  cubeCamera: THREE.CubeCamera;
  pmremTarget: THREE.WebGLRenderTarget | null;
}

const _probeBox = new THREE.Box3();
const _probeCenter = new THREE.Vector3();
const _tempDir = new THREE.Vector3();

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const renderable = obj as unknown as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) {
      renderable.geometry.dispose();
    }
    const mat = renderable.material;
    if (Array.isArray(mat)) {
      mat.forEach((m) => m.dispose());
    } else if (mat) {
      mat.dispose();
    }
    if (obj.userData?.originalMaterials instanceof Map) {
      for (const orig of obj.userData.originalMaterials.values()) {
        if (Array.isArray(orig)) {
          orig.forEach((m: THREE.Material) => m.dispose());
        } else if (orig && typeof (orig as THREE.Material).dispose === 'function') {
          (orig as THREE.Material).dispose();
        }
      }
      obj.userData.originalMaterials.clear();
    }
  });
}

export interface EngineCallbacks {
  onSelectNode: (nodeId: string | null) => void;
  onTransformNode: (nodeId: string, transform: TransformProps) => void;
  onCameraChange: (camera: CameraState) => void;
  onContextLostChange?: (lost: boolean) => void;
  onPathTracerStatusChange?: (status: PathTracerStatus) => void;
}

interface PathTracerDirtyFlags {
  scene: boolean;
  lights: boolean;
  materials: boolean;
  environment: boolean;
  camera: boolean;
  reset: boolean;
}

export class ThreeViewportEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private pmremGenerator: THREE.PMREMGenerator;
  private hemisphereLight: THREE.HemisphereLight;
  private bounceFillLight: THREE.DirectionalLight;
  private workbenchKeyLight: THREE.DirectionalLight;
  private workbenchFillLight: THREE.DirectionalLight;
  private gridHelper: THREE.GridHelper;
  private axesHelper: THREE.AxesHelper;
  private shadowCatcher: THREE.Mesh;
  private selectionBox: THREE.BoxHelper | null = null;

  private nodeObjects = new Map<string, THREE.Object3D>();
  private reflectionProbes = new Map<string, ReflectionProbe>();
  private probesDirty = true;
  private gltfLoader: GLTFLoader;
  private dracoLoader: DRACOLoader;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };

  private pathTracer: WebGLPathTracer | null = null;
  private pathTracerEnvTexture: ProceduralEquirectTexture | null = null;
  private pathTracerIdleTimer = 0;
  private pathTracerInteracting = false;
  private ptDirty: PathTracerDirtyFlags = {
    scene: true,
    lights: true,
    materials: true,
    environment: true,
    camera: true,
    reset: true,
  };
  private lastReportedPtStatusKey = '';

  private selectedNodeId: string | null = null;
  private transformMode: TransformMode = 'translate';
  private snapEnabled = false;
  private shadingMode: ViewportShadingMode = 'render';
  private lightStatus: SceneLightStatus = {
    hasAny: true,
    hasDirectional: true,
    hasLocalOnly: false,
    maxDirectionalIntensity: 2.6,
  };
  private currentSettings: SceneSettings;

  private resizeObserver: ResizeObserver;
  private renderBusy = false;
  private renderDirty = false;
  private frameId = 0;
  private timerId = 0;
  private disposed = false;

  // Smooth camera transition targets
  private cameraAnim: {
    active: boolean;
    targetPos: THREE.Vector3;
    targetLook: THREE.Vector3;
    lastTime: number;
  } = {
    active: false,
    targetPos: new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    lastTime: 0,
  };

  constructor(container: HTMLElement, initialSettings: SceneSettings, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.currentSettings = initialSettings;
    this.isSoftwareGl = detectSoftwareGl();

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = initialSettings.toneMappingExposure;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('data-testid', 'three-canvas');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(initialSettings.backgroundColor);

    // Procedural Studio IBL Environment + reusable PMREMGenerator for dynamic CubeCamera probes
    this.pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.pmremGenerator.compileCubemapShader();
    this.envRenderTarget = this.pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;

    // Base warm/cool sky + ground bounce so shadow sides retain readability
    this.hemisphereLight = new THREE.HemisphereLight('#dbeafe', '#475569', initialSettings.ambientIntensity);
    this.hemisphereLight.position.set(0, 20, 0);
    this.scene.add(this.hemisphereLight);

    // Shadowless counter-sun bounce light simulating indirect GI bounce from ground & environment
    this.bounceFillLight = new THREE.DirectionalLight('#cbd5e1', 0);
    this.bounceFillLight.position.set(-5, 2.5, -5);
    this.bounceFillLight.castShadow = false;
    this.bounceFillLight.visible = false;
    this.scene.add(this.bounceFillLight);
    this.scene.add(this.bounceFillLight.target);

    // Neutral studio workbench lights used exclusively in "objects" mode
    this.workbenchKeyLight = new THREE.DirectionalLight('#ffffff', 1.35);
    this.workbenchKeyLight.position.set(6, 10, 8);
    this.workbenchKeyLight.castShadow = false;
    this.workbenchKeyLight.visible = false;
    this.scene.add(this.workbenchKeyLight);

    this.workbenchFillLight = new THREE.DirectionalLight('#cbd5e1', 0.65);
    this.workbenchFillLight.position.set(-6, 4, -6);
    this.workbenchFillLight.castShadow = false;
    this.workbenchFillLight.visible = false;
    this.scene.add(this.workbenchFillLight);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    this.camera.position.set(5.2, 3.8, 6.4);

    // OrbitControls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = !this.isSoftwareGl;
    this.orbitControls.dampingFactor = 0.07;
    this.orbitControls.minDistance = 0.8;
    this.orbitControls.maxDistance = 120;
    this.orbitControls.target.set(0, 0.8, 0);

    // TransformControls
    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setSize(0.85);
    this.gizmoHelper = this.transformControls.getHelper();
    this.scene.add(this.gizmoHelper);

    // Grid & Axes & Ground Shadow Catcher
    this.gridHelper = new THREE.GridHelper(24, 24, '#3b4252', '#232833');
    this.gridHelper.visible = initialSettings.gridVisible;
    this.scene.add(this.gridHelper);

    this.axesHelper = new THREE.AxesHelper(2.5);
    this.axesHelper.position.y = 0.002;
    this.axesHelper.visible = initialSettings.axesVisible;
    this.scene.add(this.axesHelper);

    const floorGeo = new THREE.PlaneGeometry(40, 40);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.78 });
    this.shadowCatcher = new THREE.Mesh(floorGeo, floorMat);
    this.shadowCatcher.position.y = -0.002;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    // GLTF + Draco Loaders
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);

    this.applySceneSettings(initialSettings);
    this.bindEvents();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.requestRender();
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    this.orbitControls.addEventListener('start', () => {
      this.cameraAnim.active = false;
      this.notifyPathTracerInteraction({ camera: true });
    });

    this.orbitControls.addEventListener('change', () => {
      this.notifyPathTracerInteraction({ camera: true });
      this.requestRender();
    });

    this.orbitControls.addEventListener('end', () => {
      this.callbacks.onCameraChange(this.getCameraState());
    });

    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      if (event.value) {
        this.notifyPathTracerInteraction();
      } else if (this.selectedNodeId) {
        const obj = this.nodeObjects.get(this.selectedNodeId);
        if (obj) {
          this.notifyPathTracerInteraction(
            obj.userData.isLightNode ? { lights: true } : { scene: true },
          );
          this.callbacks.onTransformNode(this.selectedNodeId, this.extractTransform(obj));
        }
      }
      this.requestRender();
    });

    this.transformControls.addEventListener('objectChange', () => {
      if (this.selectionBox) {
        this.selectionBox.update();
      }
      if (this.selectedNodeId) {
        const obj = this.nodeObjects.get(this.selectedNodeId);
        if (obj) {
          this.updateLightHelperIfNeeded(obj);
          this.updateBounceFillDirection();
          this.notifyPathTracerInteraction(
            obj.userData.isLightNode ? { lights: true } : { scene: true },
          );
          this.callbacks.onTransformNode(this.selectedNodeId, this.extractTransform(obj));
        }
      }
      this.probesDirty = true;
      this.requestRender();
    });

    this.transformControls.addEventListener('change', () => {
      this.requestRender();
    });

    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('webglcontextlost', this.onContextLost);
    dom.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onContextLostChange?.(true);
  };

  private onContextRestored = (): void => {
    this.callbacks.onContextLostChange?.(false);
    this.requestRender();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    if (Math.hypot(dx, dy) > 5) return; // Was an orbit/drag gesture
    if (this.transformControls.dragging || this.transformControls.axis !== null) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickables: THREE.Object3D[] = [];
    for (const obj of this.nodeObjects.values()) {
      if (obj.visible) pickables.push(obj);
    }

    const intersects = this.raycaster.intersectObjects(pickables, true);
    if (intersects.length > 0) {
      let current: THREE.Object3D | null = intersects[0].object;
      while (current) {
        if (typeof current.userData?.nodeId === 'string') {
          this.callbacks.onSelectNode(current.userData.nodeId);
          return;
        }
        current = current.parent;
      }
    }
    this.callbacks.onSelectNode(null);
  };

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.notifyPathTracerInteraction({ camera: true });
    this.requestRender();
  }

  private getPathTracerEnvTexture(): ProceduralEquirectTexture {
    if (!this.pathTracerEnvTexture) {
      const env = new ProceduralEquirectTexture(64, 32);
      env.generationCallback = (polar, _uv, _coord, color) => {
        // phi: 0 at top pole (+Y), PI at bottom pole (-Y)
        const up = Math.cos(polar.phi);
        if (up >= 0) {
          const factor = Math.pow(up, 0.7);
          color.setRGB(
            0.34 + factor * 0.42,
            0.38 + factor * 0.44,
            0.44 + factor * 0.46,
          );
        } else {
          const down = Math.min(1, -up);
          color.setRGB(
            0.22 * (1 - down * 0.65),
            0.24 * (1 - down * 0.65),
            0.28 * (1 - down * 0.62),
          );
        }
      };
      env.update();
      this.pathTracerEnvTexture = env;
    }
    return this.pathTracerEnvTexture;
  }

  private ensurePathTracer(): WebGLPathTracer {
    if (!this.pathTracer) {
      const pt = new WebGLPathTracer(this.renderer);
      pt.renderDelay = 0;
      pt.fadeDuration = 0;
      pt.minSamples = 1;
      pt.rasterizeScene = false;
      pt.tiles.set(this.isSoftwareGl ? 4 : 2, this.isSoftwareGl ? 4 : 2);
      pt.multipleImportanceSampling = true;
      pt.filterGlossyFactor = 0.5;
      this.pathTracer = pt;
      this.ptDirty.scene = true;
    }
    return this.pathTracer;
  }

  private reportPathTracerStatus(status: PathTracerStatus): void {
    const key = `${status.phase}:${status.samples}:${status.maxSamples}`;
    if (key === this.lastReportedPtStatusKey) return;
    this.lastReportedPtStatusKey = key;
    this.callbacks.onPathTracerStatusChange?.(status);
  }

  private isPathTracerEnabled(): boolean {
    return this.currentSettings.renderEngine === 'pathtracer' && this.shadingMode === 'render';
  }

  private notifyPathTracerInteraction(dirty?: Partial<PathTracerDirtyFlags>, immediate = false): void {
    if (dirty) {
      if (dirty.scene) this.ptDirty.scene = true;
      if (dirty.lights) this.ptDirty.lights = true;
      if (dirty.materials) this.ptDirty.materials = true;
      if (dirty.environment) this.ptDirty.environment = true;
      if (dirty.camera) this.ptDirty.camera = true;
      if (dirty.reset) this.ptDirty.reset = true;
    }

    if (!this.isPathTracerEnabled()) return;

    clearTimeout(this.pathTracerIdleTimer);
    if (immediate) {
      this.pathTracerInteracting = false;
      this.requestRender();
      return;
    }

    this.pathTracerInteracting = true;
    this.pathTracerIdleTimer = window.setTimeout(() => {
      if (this.disposed) return;
      this.pathTracerInteracting = false;
      this.requestRender();
    }, 180);
  }

  public resetPathTracer(): void {
    clearTimeout(this.pathTracerIdleTimer);
    this.pathTracerInteracting = false;
    this.ptDirty.reset = true;
    this.requestRender();
  }

  private withPathTracerSceneState<T>(fn: () => T): T {
    const prevGizmo = this.gizmoHelper.visible;
    const prevBox = this.selectionBox?.visible ?? false;
    const prevGrid = this.gridHelper.visible;
    const prevAxes = this.axesHelper.visible;
    const prevCatcher = this.shadowCatcher.visible;
    const prevWorkbenchKey = this.workbenchKeyLight.visible;
    const prevWorkbenchFill = this.workbenchFillLight.visible;
    const prevBounceFill = this.bounceFillLight.visible;
    const prevEnv = this.scene.environment;
    const prevEnvIntensity = this.scene.environmentIntensity;
    const prevFog = this.scene.fog;

    const prevLightHelpers: Array<{ obj: THREE.Object3D; visible: boolean }> = [];
    for (const obj of this.nodeObjects.values()) {
      if (!obj.userData.isLightNode) continue;
      for (const key of ['proxyMesh', 'rangeHelper'] as const) {
        const helper = obj.userData[key] as THREE.Object3D | undefined;
        if (helper) {
          prevLightHelpers.push({ obj: helper, visible: helper.visible });
          helper.visible = false;
        }
      }
    }

    const prevEnvMaps: Array<{ mat: THREE.MeshStandardMaterial; envMap: THREE.Texture | null }> = [];
    for (const obj of this.nodeObjects.values()) {
      if (obj.userData.isLightNode) continue;
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial && m.envMap !== null) {
            prevEnvMaps.push({ mat: m, envMap: m.envMap });
            m.envMap = null;
          }
        }
      });
    }

    const resolved = resolveViewportLighting(this.shadingMode, this.lightStatus, this.currentSettings);

    this.gizmoHelper.visible = false;
    if (this.selectionBox) this.selectionBox.visible = false;
    this.gridHelper.visible = false;
    this.axesHelper.visible = false;
    this.shadowCatcher.visible = false;
    this.workbenchKeyLight.visible = false;
    this.workbenchFillLight.visible = false;
    this.bounceFillLight.visible = false;
    this.scene.fog = null;

    if (resolved.useEnvironment) {
      this.scene.environment = this.getPathTracerEnvTexture();
      this.scene.environmentIntensity = roundTo(clamp(0.35 + 0.65 * resolved.environmentIntensity, 0.25, 1.1), 3);
    } else {
      this.scene.environment = null;
      this.scene.environmentIntensity = 0;
    }

    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();

    try {
      return fn();
    } finally {
      this.gizmoHelper.visible = prevGizmo;
      if (this.selectionBox) this.selectionBox.visible = prevBox;
      this.gridHelper.visible = prevGrid;
      this.axesHelper.visible = prevAxes;
      this.shadowCatcher.visible = prevCatcher;
      this.workbenchKeyLight.visible = prevWorkbenchKey;
      this.workbenchFillLight.visible = prevWorkbenchFill;
      this.bounceFillLight.visible = prevBounceFill;
      this.scene.environment = prevEnv;
      this.scene.environmentIntensity = prevEnvIntensity;
      this.scene.fog = prevFog;

      for (const item of prevLightHelpers) {
        item.obj.visible = item.visible;
      }
      for (const item of prevEnvMaps) {
        item.mat.envMap = item.envMap;
      }
    }
  }

  public requestRender(): void {
    if (this.disposed) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.frameId = requestAnimationFrame((now) => {
      if (this.disposed) return;
      this.renderDirty = false;

      if (this.cameraAnim.active) {
        const dt = Math.min(0.1, Math.max(0.001, (now - this.cameraAnim.lastTime) / 1000));
        this.cameraAnim.lastTime = now;
        const lambda = 9;
        this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.cameraAnim.targetPos.x, lambda, dt);
        this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.cameraAnim.targetPos.y, lambda, dt);
        this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.cameraAnim.targetPos.z, lambda, dt);
        this.orbitControls.target.x = THREE.MathUtils.damp(this.orbitControls.target.x, this.cameraAnim.targetLook.x, lambda, dt);
        this.orbitControls.target.y = THREE.MathUtils.damp(this.orbitControls.target.y, this.cameraAnim.targetLook.y, lambda, dt);
        this.orbitControls.target.z = THREE.MathUtils.damp(this.orbitControls.target.z, this.cameraAnim.targetLook.z, lambda, dt);

        if (
          this.camera.position.distanceTo(this.cameraAnim.targetPos) < 0.015 &&
          this.orbitControls.target.distanceTo(this.cameraAnim.targetLook) < 0.015
        ) {
          this.camera.position.copy(this.cameraAnim.targetPos);
          this.orbitControls.target.copy(this.cameraAnim.targetLook);
          this.cameraAnim.active = false;
        } else {
          this.notifyPathTracerInteraction({ camera: true });
          this.renderDirty = true;
        }
      }

      const ptSettings = this.currentSettings.pathTracer;
      const ptActive = this.isPathTracerEnabled();

      if (!ptActive) {
        if (this.probesDirty) {
          this.updateReflectionProbes();
        }
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
        this.reportPathTracerStatus({
          phase: 'idle',
          samples: 0,
          maxSamples: ptSettings.maxSamples,
        });
      } else if (this.pathTracerInteracting || this.cameraAnim.active) {
        if (this.probesDirty) {
          this.updateReflectionProbes();
        }
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
        this.reportPathTracerStatus({
          phase: 'preview',
          samples: 0,
          maxSamples: ptSettings.maxSamples,
        });
      } else if (
        ptSettings.paused &&
        (!this.pathTracer ||
          Math.floor(this.pathTracer.samples) === 0 ||
          this.ptDirty.scene ||
          this.ptDirty.camera)
      ) {
        if (this.probesDirty) {
          this.updateReflectionProbes();
        }
        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
        this.reportPathTracerStatus({
          phase: 'paused',
          samples: 0,
          maxSamples: ptSettings.maxSamples,
        });
      } else {
        const pt = this.ensurePathTracer();
        pt.bounces = this.isSoftwareGl ? Math.min(ptSettings.bounces, 2) : ptSettings.bounces;
        pt.renderScale = this.isSoftwareGl
          ? Math.min(ptSettings.renderScale, 0.25)
          : ptSettings.renderScale;

        if (pt.samples < 1 || this.ptDirty.scene || this.ptDirty.reset) {
          if (this.probesDirty) {
            this.updateReflectionProbes();
          }
          this.renderer.render(this.scene, this.camera);
        }

        this.withPathTracerSceneState(() => {
          if (this.ptDirty.scene) {
            pt.setScene(this.scene, this.camera);
            this.ptDirty.scene = false;
            this.ptDirty.lights = false;
            this.ptDirty.materials = false;
            this.ptDirty.environment = false;
            this.ptDirty.camera = false;
            this.ptDirty.reset = false;
          } else {
            if (this.ptDirty.environment) {
              pt.updateEnvironment();
              this.ptDirty.environment = false;
            }
            if (this.ptDirty.lights) {
              pt.updateLights();
              this.ptDirty.lights = false;
            }
            if (this.ptDirty.materials) {
              pt.updateMaterials();
              this.ptDirty.materials = false;
            }
            if (this.ptDirty.camera) {
              pt.updateCamera();
              this.ptDirty.camera = false;
            }
            if (this.ptDirty.reset) {
              pt.reset();
              this.ptDirty.reset = false;
            }
          }

          const t0 = performance.now();
          (window as unknown as Record<string, unknown>).__ptDiag = {
            stage: 'before-sample',
            rawSamples: pt.samples,
            isCompiling: pt.isCompiling,
            tiles: [pt.tiles.x, pt.tiles.y],
            renderScale: pt.renderScale,
            bounces: pt.bounces,
          };
          if (ptSettings.paused) {
            pt.pausePathTracing = true;
            pt.renderSample();
            this.reportPathTracerStatus({
              phase: 'paused',
              samples: Math.floor(pt.samples),
              maxSamples: ptSettings.maxSamples,
            });
          } else {
            const reachedMax = Math.floor(pt.samples) >= ptSettings.maxSamples;
            pt.pausePathTracing = reachedMax;
            pt.renderSample();

            const samples = Math.floor(pt.samples);
            const complete = samples >= ptSettings.maxSamples;
            this.reportPathTracerStatus({
              phase: complete ? 'complete' : 'tracing',
              samples: Math.min(samples, ptSettings.maxSamples),
              maxSamples: ptSettings.maxSamples,
            });

            if (!complete) {
              this.renderDirty = true;
            }
          }
          const dtSample = Math.round(performance.now() - t0);
          (window as unknown as Record<string, unknown>).__ptDiag = {
            stage: 'after-sample',
            rawSamples: pt.samples,
            isCompiling: pt.isCompiling,
            tiles: [pt.tiles.x, pt.tiles.y],
            renderScale: pt.renderScale,
            bounces: pt.bounces,
            dtSample,
            renderDirty: this.renderDirty,
            renderBusy: this.renderBusy,
            doneCount: (((window as unknown as Record<string, { doneCount?: number }>).__ptDiag)?.doneCount ?? 0),
          };
        });
      }

      const done = () => {
        const d = (window as unknown as Record<string, { doneCount?: number }>).__ptDiag;
        if (d) d.doneCount = (d.doneCount ?? 0) + 1;
        this.renderBusy = false;
        if (this.renderDirty) this.requestRender();
      };

      if (this.isSoftwareGl) {
        this.afterDraw(done);
      } else {
        done();
      }
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.timerId = window.setTimeout(cb, 30);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.timerId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.timerId = window.setTimeout(cb, 40);
      }
    };
    this.timerId = window.setTimeout(poll, 5);
  }

  public applySceneSettings(settings: SceneSettings): void {
    const prev = this.currentSettings;
    this.currentSettings = settings;

    const engineChanged = prev.renderEngine !== settings.renderEngine;
    const bounceOrScaleChanged =
      prev.pathTracer.bounces !== settings.pathTracer.bounces ||
      prev.pathTracer.renderScale !== settings.pathTracer.renderScale;
    const envChanged =
      prev.backgroundColor !== settings.backgroundColor ||
      prev.ambientIntensity !== settings.ambientIntensity ||
      prev.bounceIntensity !== settings.bounceIntensity;
    const pauseChanged = prev.pathTracer.paused !== settings.pathTracer.paused;
    const maxSamplesChanged = prev.pathTracer.maxSamples !== settings.pathTracer.maxSamples;

    if (engineChanged) {
      clearTimeout(this.pathTracerIdleTimer);
      this.pathTracerInteracting = false;
      if (settings.renderEngine === 'pathtracer') {
        this.ptDirty.scene = true;
      }
    } else if (bounceOrScaleChanged) {
      this.notifyPathTracerInteraction({ reset: true });
    } else if (envChanged) {
      this.notifyPathTracerInteraction({ environment: true });
    } else if (pauseChanged || maxSamplesChanged) {
      clearTimeout(this.pathTracerIdleTimer);
      this.pathTracerInteracting = false;
    }

    this.syncLightingAndEnvironment();
  }

  public setShadingState(
    mode: ViewportShadingMode,
    lightStatus: SceneLightStatus | boolean,
    settings?: SceneSettings,
  ): void {
    const prevMode = this.shadingMode;
    this.shadingMode = mode;
    this.lightStatus =
      typeof lightStatus === 'boolean'
        ? {
            hasAny: lightStatus,
            hasDirectional: lightStatus,
            hasLocalOnly: false,
            maxDirectionalIntensity: lightStatus ? 2.4 : 0,
          }
        : lightStatus;
    if (settings) {
      this.currentSettings = settings;
    }
    if (mode === 'render' && prevMode !== 'render' && this.currentSettings.renderEngine === 'pathtracer') {
      this.ptDirty.scene = true;
    } else if (this.currentSettings.renderEngine === 'pathtracer') {
      this.ptDirty.environment = true;
    }
    this.syncLightingAndEnvironment();
  }

  private updateLightVisualHelpers(
    resolved = resolveViewportLighting(this.shadingMode, this.lightStatus, this.currentSettings),
  ): void {
    for (const obj of this.nodeObjects.values()) {
      if (!obj.userData.isLightNode) continue;
      const light = obj.userData.lightInstance as THREE.Light | undefined;
      const proxy = obj.userData.proxyMesh as THREE.Mesh | undefined;
      const rangeHelper = obj.userData.rangeHelper as THREE.LineSegments | undefined;
      const lp = obj.userData.lightProps as LightProps | undefined;
      const isSelected = obj.userData.nodeId === this.selectedNodeId;
      const isActive = obj.visible && (lp?.intensity ?? 0) > 0;

      if (light) {
        light.visible = this.shadingMode === 'render';
      }
      if (proxy) {
        proxy.visible =
          obj.visible && (this.shadingMode === 'objects' || isSelected || (!resolved.isDarkRender && isActive));
      }
      if (rangeHelper) {
        rangeHelper.visible = obj.visible && isSelected;
      }
    }
  }

  private updateBounceFillDirection(): void {
    let bestSun: THREE.DirectionalLight | null = null;
    let bestSunObj: THREE.Object3D | null = null;
    let bestIntensity = 0;

    for (const obj of this.nodeObjects.values()) {
      if (!obj.visible || !obj.userData.isLightNode) continue;
      const light = obj.userData.lightInstance as THREE.Light | undefined;
      if (light instanceof THREE.DirectionalLight && light.intensity > bestIntensity) {
        bestIntensity = light.intensity;
        bestSun = light;
        bestSunObj = obj;
      }
    }

    if (!bestSun || !bestSunObj) return;

    const worldTarget = bestSunObj.userData.lightTarget as THREE.Object3D | undefined;
    if (worldTarget) {
      _tempDir.copy(bestSunObj.position).sub(worldTarget.position);
    } else {
      _tempDir.copy(bestSunObj.position);
    }
    if (_tempDir.lengthSq() < 1e-4) {
      _tempDir.set(5, 8, 5);
    }
    _tempDir.normalize();

    this.bounceFillLight.position.set(
      -_tempDir.x * 8,
      Math.max(1.8, 3.2 - _tempDir.y * 1.2),
      -_tempDir.z * 8,
    );
    this.bounceFillLight.target.position.set(0, 0.4, 0);
    this.bounceFillLight.target.updateMatrixWorld(true);
    // Tint bounce softly between cool sky bounce and warm sun bounce
    this.bounceFillLight.color.set('#cbd5e1').lerp(bestSun.color, 0.3);
  }

  private syncLightingAndEnvironment(): void {
    const resolved = resolveViewportLighting(this.shadingMode, this.lightStatus, this.currentSettings);

    this.workbenchKeyLight.visible = resolved.useWorkbenchLight;
    this.workbenchFillLight.visible = resolved.useWorkbenchLight;
    this.scene.environment = resolved.useEnvironment ? this.envRenderTarget.texture : null;
    this.scene.environmentIntensity = resolved.environmentIntensity;
    this.hemisphereLight.intensity = resolved.ambientIntensity;
    this.bounceFillLight.visible = resolved.bounceFillIntensity > 0;
    this.bounceFillLight.intensity = resolved.bounceFillIntensity;
    if (resolved.bounceFillIntensity > 0) {
      this.updateBounceFillDirection();
    }
    this.scene.background = new THREE.Color(resolved.backgroundColor);
    this.scene.fog = resolved.fogEnabled
      ? new THREE.FogExp2(this.currentSettings.fogColor, this.currentSettings.fogDensity)
      : null;
    this.gridHelper.visible = resolved.gridVisible;
    this.axesHelper.visible = resolved.isDarkRender ? false : this.currentSettings.axesVisible;
    this.shadowCatcher.visible = resolved.shadowsEnabled && !resolved.isPitchBlack;
    this.renderer.toneMappingExposure = this.currentSettings.toneMappingExposure;

    if (this.renderer.shadowMap.enabled !== resolved.shadowsEnabled) {
      this.renderer.shadowMap.enabled = resolved.shadowsEnabled;
      this.renderer.shadowMap.needsUpdate = true;
    }

    this.updateLightVisualHelpers(resolved);
    this.probesDirty = true;
    this.requestRender();
  }

  public setCameraState(cam: CameraState): void {
    this.cameraAnim.active = false;
    this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);
    this.orbitControls.target.set(cam.target.x, cam.target.y, cam.target.z);
    this.orbitControls.update();
    this.notifyPathTracerInteraction({ camera: true });
    this.requestRender();
  }

  public getCameraState(): CameraState {
    return {
      position: {
        x: roundTo(this.camera.position.x, 3),
        y: roundTo(this.camera.position.y, 3),
        z: roundTo(this.camera.position.z, 3),
      },
      target: {
        x: roundTo(this.orbitControls.target.x, 3),
        y: roundTo(this.orbitControls.target.y, 3),
        z: roundTo(this.orbitControls.target.z, 3),
      },
    };
  }

  public setTransformMode(mode: TransformMode): void {
    this.transformMode = mode;
    if (mode === 'select') {
      this.transformControls.detach();
      this.gizmoHelper.visible = false;
    } else {
      this.transformControls.setMode(mode);
      if (this.selectedNodeId) {
        const obj = this.nodeObjects.get(this.selectedNodeId);
        if (obj) {
          this.transformControls.attach(obj);
          this.gizmoHelper.visible = true;
        }
      }
    }
    this.requestRender();
  }

  public setTransformSpace(space: TransformSpace): void {
    this.transformControls.setSpace(space);
    this.requestRender();
  }

  public setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
    if (enabled) {
      this.transformControls.setTranslationSnap(0.25);
      this.transformControls.setRotationSnap(degToRad(15));
      this.transformControls.setScaleSnap(0.1);
    } else {
      this.transformControls.setTranslationSnap(null);
      this.transformControls.setRotationSnap(null);
      this.transformControls.setScaleSnap(null);
    }
  }

  public selectNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.dispose();
      this.selectionBox = null;
    }

    if (nodeId && this.nodeObjects.has(nodeId)) {
      const obj = this.nodeObjects.get(nodeId)!;
      if (this.transformMode !== 'select') {
        this.transformControls.attach(obj);
        this.gizmoHelper.visible = true;
      } else {
        this.transformControls.detach();
        this.gizmoHelper.visible = false;
      }

      // BoxHelper highlights meshes nicely
      if (!obj.userData.isLightNode) {
        this.selectionBox = new THREE.BoxHelper(obj, '#3b82f6');
        this.scene.add(this.selectionBox);
      }
    } else {
      this.transformControls.detach();
      this.gizmoHelper.visible = false;
    }
    this.updateLightVisualHelpers();
    this.requestRender();
  }

  public focusOnNode(nodeId: string | null): void {
    if (!nodeId) {
      this.cameraAnim = {
        active: true,
        targetPos: new THREE.Vector3(5.2, 3.8, 6.4),
        targetLook: new THREE.Vector3(0, 0.8, 0),
        lastTime: performance.now(),
      };
      this.requestRender();
      return;
    }

    const obj = this.nodeObjects.get(nodeId);
    if (!obj) return;

    const box = new THREE.Box3().setFromObject(obj);
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z, 1.2);
    const dist = maxDim * 2.4;
    const dir = this.camera.position.clone().sub(this.orbitControls.target).normalize();
    if (dir.lengthSq() < 0.001) dir.set(0.6, 0.45, 0.7).normalize();

    this.cameraAnim = {
      active: true,
      targetPos: center.clone().add(dir.multiplyScalar(dist)),
      targetLook: center,
      lastTime: performance.now(),
    };
    this.requestRender();
  }

  public groundNodeToFloor(nodeId: string): TransformProps | null {
    const obj = this.nodeObjects.get(nodeId);
    if (!obj || obj.userData.isLightNode) return null;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) {
      obj.position.y -= box.min.y;
      obj.updateMatrixWorld(true);
    }
    if (this.selectionBox) this.selectionBox.update();
    this.probesDirty = true;
    this.notifyPathTracerInteraction({ scene: true });
    this.requestRender();
    return this.extractTransform(obj);
  }

  private extractTransform(obj: THREE.Object3D): TransformProps {
    return {
      position: {
        x: roundTo(obj.position.x, 3),
        y: roundTo(obj.position.y, 3),
        z: roundTo(obj.position.z, 3),
      },
      rotationDeg: {
        x: roundTo(radToDeg(obj.rotation.x), 2),
        y: roundTo(radToDeg(obj.rotation.y), 2),
        z: roundTo(radToDeg(obj.rotation.z), 2),
      },
      scale: {
        x: roundTo(obj.scale.x, 3),
        y: roundTo(obj.scale.y, 3),
        z: roundTo(obj.scale.z, 3),
      },
    };
  }

  private applyTransformToObject(obj: THREE.Object3D, t: TransformProps): void {
    obj.position.set(t.position.x, t.position.y, t.position.z);
    obj.rotation.set(degToRad(t.rotationDeg.x), degToRad(t.rotationDeg.y), degToRad(t.rotationDeg.z));
    obj.scale.set(
      Math.max(0.01, t.scale.x),
      Math.max(0.01, t.scale.y),
      Math.max(0.01, t.scale.z),
    );
  }

  private applyMaterialToMesh(mesh: THREE.Mesh, matProps: MaterialProps): void {
    let mat = mesh.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) {
      mat = new THREE.MeshStandardMaterial();
      mesh.material = mat;
    }
    const stdMat = mat as THREE.MeshStandardMaterial;
    stdMat.color.set(matProps.color);
    stdMat.roughness = matProps.roughness;
    stdMat.metalness = matProps.metalness;
    stdMat.emissive.set(matProps.emissive);
    stdMat.emissiveIntensity = matProps.emissiveIntensity;
    stdMat.opacity = matProps.opacity;
    stdMat.transparent = matProps.transparent || matProps.opacity < 0.999;
    stdMat.wireframe = matProps.wireframe;
    if (stdMat.flatShading !== matProps.flatShading) {
      stdMat.flatShading = matProps.flatShading;
      stdMat.needsUpdate = true;
    }
    stdMat.needsUpdate = true;
  }

  public addOrUpdatePrimitiveNode(node: SceneNode): void {
    if (node.kind !== 'primitive' || !node.primitiveType) return;

    let mesh = this.nodeObjects.get(node.id) as THREE.Mesh | undefined;
    const isNew = !mesh;
    if (!mesh) {
      const geo = createPrimitiveGeometry(node.primitiveType);
      const mat = new THREE.MeshStandardMaterial();
      mesh = new THREE.Mesh(geo, mat);
      mesh.userData.nodeId = node.id;
      this.scene.add(mesh);
      this.nodeObjects.set(node.id, mesh);
    }

    const geometryOrTransformChanged =
      isNew ||
      mesh.visible !== node.visible ||
      mesh.position.x !== node.transform.position.x ||
      mesh.position.y !== node.transform.position.y ||
      mesh.position.z !== node.transform.position.z ||
      Math.abs(radToDeg(mesh.rotation.x) - node.transform.rotationDeg.x) > 0.01 ||
      Math.abs(radToDeg(mesh.rotation.y) - node.transform.rotationDeg.y) > 0.01 ||
      Math.abs(radToDeg(mesh.rotation.z) - node.transform.rotationDeg.z) > 0.01 ||
      mesh.scale.x !== Math.max(0.01, node.transform.scale.x) ||
      mesh.scale.y !== Math.max(0.01, node.transform.scale.y) ||
      mesh.scale.z !== Math.max(0.01, node.transform.scale.z);

    mesh.name = node.name;
    mesh.visible = node.visible;
    mesh.castShadow = node.castShadow;
    mesh.receiveShadow = node.receiveShadow;
    this.applyTransformToObject(mesh, node.transform);
    if (node.material) {
      this.applyMaterialToMesh(mesh, node.material);
    }

    if (this.selectedNodeId === node.id && this.selectionBox) {
      this.selectionBox.update();
    }
    this.probesDirty = true;
    this.notifyPathTracerInteraction(
      geometryOrTransformChanged ? { scene: true } : { materials: true },
    );
    this.requestRender();
  }

  public addOrUpdateLightNode(node: SceneNode): void {
    if (node.kind !== 'light' || !node.light) return;

    let group = this.nodeObjects.get(node.id) as THREE.Group | undefined;
    if (!group) {
      group = new THREE.Group();
      group.userData.nodeId = node.id;
      group.userData.isLightNode = true;

      let light: THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight;
      if (node.light.lightKind === 'directional') {
        light = new THREE.DirectionalLight(node.light.color, node.light.intensity);
        const dirShadowRes = this.isSoftwareGl ? 1024 : 2048;
        light.shadow.mapSize.set(dirShadowRes, dirShadowRes);
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 50;
        const d = 12;
        light.shadow.camera.left = -d;
        light.shadow.camera.right = d;
        light.shadow.camera.top = d;
        light.shadow.camera.bottom = -d;
        light.shadow.bias = -0.0003;
        light.shadow.normalBias = 0.02;
        light.shadow.radius = 2;
        this.scene.add(light.target);
        group.userData.lightTarget = light.target;
      } else if (node.light.lightKind === 'spot') {
        light = new THREE.SpotLight(
          node.light.color,
          node.light.intensity,
          node.light.distance,
          degToRad(node.light.angleDeg),
          node.light.penumbra,
          node.light.decay,
        );
        light.shadow.mapSize.set(this.isSoftwareGl ? 512 : 1024, this.isSoftwareGl ? 512 : 1024);
        light.shadow.camera.near = 0.25;
        light.shadow.bias = -0.0004;
        light.target.position.set(0, -1, 0);
        group.add(light.target);
        group.userData.localLightTarget = light.target;
      } else {
        light = new THREE.PointLight(
          node.light.color,
          node.light.intensity,
          node.light.distance,
          node.light.decay,
        );
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 0.25;
        light.shadow.bias = -0.002;
      }

      light.userData.nodeId = node.id;
      group.add(light);
      group.userData.lightInstance = light;

      // Small clickable light bulb proxy mesh so lights can be selected & positioned in viewport
      const proxyGeo = new THREE.OctahedronGeometry(0.18, 0);
      const proxyMat = new THREE.MeshBasicMaterial({
        color: node.light.color,
        wireframe: true,
      });
      const proxyMesh = new THREE.Mesh(proxyGeo, proxyMat);
      proxyMesh.userData.nodeId = node.id;
      group.add(proxyMesh);
      group.userData.proxyMesh = proxyMesh;

      if (node.light.lightKind === 'directional') {
        const rangeGeo = createDirectionalArrowGeometry();
        const rangeMat = new THREE.LineBasicMaterial({
          color: node.light.color,
          transparent: true,
          opacity: 0.65,
        });
        const rangeHelper = new THREE.LineSegments(rangeGeo, rangeMat);
        rangeHelper.raycast = () => {};
        rangeHelper.visible = false;
        group.add(rangeHelper);
        group.userData.rangeHelper = rangeHelper;
        group.userData.rangeKey = 'directional';
      } else if (node.light.lightKind === 'point' || node.light.lightKind === 'spot') {
        const rangeGeo =
          node.light.lightKind === 'point'
            ? createPointRangeGeometry(Math.max(0.5, node.light.distance || 5.5))
            : createSpotConeGeometry(Math.max(0.5, node.light.distance || 6), node.light.angleDeg);
        const rangeMat = new THREE.LineBasicMaterial({
          color: node.light.color,
          transparent: true,
          opacity: 0.38,
        });
        const rangeHelper = new THREE.LineSegments(rangeGeo, rangeMat);
        rangeHelper.raycast = () => {};
        rangeHelper.visible = false;
        group.add(rangeHelper);
        group.userData.rangeHelper = rangeHelper;
        group.userData.rangeKey = `${node.light.lightKind}:${node.light.distance}:${node.light.angleDeg}`;
      }

      this.scene.add(group);
      this.nodeObjects.set(node.id, group);
    }

    group.name = node.name;
    group.visible = node.visible;
    group.userData.lightProps = node.light;
    this.applyTransformToObject(group, node.transform);

    const light = group.userData.lightInstance as
      | THREE.DirectionalLight
      | THREE.PointLight
      | THREE.SpotLight;
    const lp: LightProps = node.light;
    light.color.set(lp.color);
    light.intensity = lp.intensity;
    light.visible = this.shadingMode === 'render';
    light.castShadow = lp.castShadow;
    light.shadow.intensity = clamp(lp.shadowIntensity ?? 1, 0, 1);

    if (light instanceof THREE.PointLight) {
      light.distance = lp.distance;
      light.decay = lp.decay;
      const far = Math.max(2, lp.distance > 0 ? lp.distance : 40);
      if (light.shadow.camera.far !== far) {
        light.shadow.camera.far = far;
        light.shadow.camera.updateProjectionMatrix();
      }
    } else if (light instanceof THREE.SpotLight) {
      light.distance = lp.distance;
      light.decay = lp.decay;
      light.angle = degToRad(lp.angleDeg);
      light.penumbra = lp.penumbra;
      const far = Math.max(2, lp.distance > 0 ? lp.distance : 40);
      if (light.shadow.camera.far !== far) {
        light.shadow.camera.far = far;
        light.shadow.camera.updateProjectionMatrix();
      }
    }

    const proxy = group.userData.proxyMesh as THREE.Mesh | undefined;
    if (proxy && proxy.material instanceof THREE.MeshBasicMaterial) {
      proxy.material.color.set(lp.color);
    }

    const rangeHelper = group.userData.rangeHelper as THREE.LineSegments | undefined;
    if (rangeHelper) {
      if (rangeHelper.material instanceof THREE.LineBasicMaterial) {
        rangeHelper.material.color.set(lp.color);
      }
      if (lp.lightKind !== 'directional') {
        const nextKey = `${lp.lightKind}:${lp.distance}:${lp.angleDeg}`;
        if (group.userData.rangeKey !== nextKey) {
          rangeHelper.geometry.dispose();
          rangeHelper.geometry =
            lp.lightKind === 'point'
              ? createPointRangeGeometry(Math.max(0.5, lp.distance || 5.5))
              : createSpotConeGeometry(Math.max(0.5, lp.distance || 6), lp.angleDeg);
          group.userData.rangeKey = nextKey;
        }
      }
    }

    this.updateLightHelperIfNeeded(group);
    this.updateBounceFillDirection();
    this.updateLightVisualHelpers();
    this.probesDirty = true;
    this.notifyPathTracerInteraction({ lights: true });
    this.requestRender();
  }

  private updateLightHelperIfNeeded(obj: THREE.Object3D): void {
    obj.updateMatrixWorld(true);
    const worldTarget = obj.userData?.lightTarget as THREE.Object3D | undefined;
    if (worldTarget) {
      const hasRotation =
        Math.abs(obj.rotation.x) > 1e-4 ||
        Math.abs(obj.rotation.y) > 1e-4 ||
        Math.abs(obj.rotation.z) > 1e-4;
      if (hasRotation) {
        _tempDir.set(0, -1, 0).applyEuler(obj.rotation).normalize();
        worldTarget.position.copy(obj.position).addScaledVector(_tempDir, 10);
      } else if (obj.position.lengthSq() > 0.01) {
        worldTarget.position.set(0, 0, 0);
      } else {
        worldTarget.position.set(0, -1, 0);
      }
      worldTarget.updateMatrixWorld(true);

      const rangeHelper = obj.userData?.rangeHelper as THREE.Object3D | undefined;
      if (rangeHelper) {
        rangeHelper.lookAt(worldTarget.position);
      }
      return;
    }

    const localTarget = obj.userData?.localLightTarget as THREE.Object3D | undefined;
    if (localTarget) {
      localTarget.updateMatrixWorld(true);
    }
  }

  public async parseAndMountGlb(
    node: SceneNode,
    buffer: ArrayBuffer,
    normalizeOnFirstMount = false,
  ): Promise<GlbMetadata> {
    const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
      this.gltfLoader.parse(
        buffer,
        '',
        (res) => resolve(res),
        (err) => reject(err instanceof Error ? err : new Error('Ошибка чтения .glb файла')),
      );
    });

    const existing = this.nodeObjects.get(node.id);
    if (existing) {
      if (this.transformControls.object === existing) {
        this.transformControls.detach();
      }
      this.scene.remove(existing);
      disposeObjectResources(existing);
      this.nodeObjects.delete(node.id);
    }

    const wrapper = new THREE.Group();
    wrapper.name = node.name;
    wrapper.userData.nodeId = node.id;

    const modelRoot = gltf.scene;
    const originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();
    let meshCount = 0;
    let triangleCount = 0;

    modelRoot.traverse((child) => {
      child.userData.nodeId = node.id;
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        meshCount += 1;
        if (mesh.geometry) {
          const idx = mesh.geometry.index;
          const pos = mesh.geometry.attributes.position;
          if (idx) {
            triangleCount += Math.floor(idx.count / 3);
          } else if (pos) {
            triangleCount += Math.floor(pos.count / 3);
          }
        }
        // Snapshot original material for non-destructive override toggling
        if (Array.isArray(mesh.material)) {
          originalMaterials.set(
            mesh.uuid,
            mesh.material.map((m) => m.clone()),
          );
        } else if (mesh.material) {
          originalMaterials.set(mesh.uuid, mesh.material.clone());
        }
      }
    });

    wrapper.userData.originalMaterials = originalMaterials;
    wrapper.add(modelRoot);

    // Center X/Z and place bottom flush at y = 0 inside wrapper
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    if (!box.isEmpty()) {
      box.getSize(size);
      box.getCenter(center);
      modelRoot.position.x -= center.x;
      modelRoot.position.z -= center.z;
      modelRoot.position.y -= box.min.y;

      if (normalizeOnFirstMount) {
        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 6 || (maxDim > 0 && maxDim < 0.25)) {
          const factor = 2.2 / maxDim;
          modelRoot.scale.multiplyScalar(factor);
          modelRoot.position.multiplyScalar(factor);
        }
      }
    }

    wrapper.updateMatrixWorld(true);
    const finalBox = new THREE.Box3().setFromObject(wrapper);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    this.scene.add(wrapper);
    this.nodeObjects.set(node.id, wrapper);
    this.updateGlbNodeProperties(node);

    return {
      fileName: node.glbMeta?.fileName ?? 'model.glb',
      fileSizeBytes: buffer.byteLength,
      meshCount,
      triangleCount,
      boundsSize: {
        x: roundTo(finalSize.x, 3),
        y: roundTo(finalSize.y, 3),
        z: roundTo(finalSize.z, 3),
      },
    };
  }

  public updateGlbNodeProperties(node: SceneNode): void {
    const wrapper = this.nodeObjects.get(node.id);
    if (!wrapper) return;

    wrapper.name = node.name;
    wrapper.visible = node.visible;
    this.applyTransformToObject(wrapper, node.transform);

    const originalMaterials = wrapper.userData.originalMaterials as
      | Map<string, THREE.Material | THREE.Material[]>
      | undefined;

    wrapper.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = node.castShadow;
        mesh.receiveShadow = node.receiveShadow;

        if (node.material?.overrideGlbMaterial) {
          this.applyMaterialToMesh(mesh, node.material);
        } else if (originalMaterials && originalMaterials.has(mesh.uuid)) {
          const orig = originalMaterials.get(mesh.uuid)!;
          if (Array.isArray(orig)) {
            mesh.material = orig.map((m) => m.clone());
          } else {
            mesh.material = orig.clone();
          }
        }
      }
    });

    if (this.selectedNodeId === node.id && this.selectionBox) {
      this.selectionBox.update();
    }
    this.probesDirty = true;
    this.notifyPathTracerInteraction({ scene: true });
    this.requestRender();
  }

  private isNodeReflective(obj: THREE.Object3D): boolean {
    if (!obj.visible || obj.userData.isLightNode) return false;
    let reflective = false;
    obj.traverse((child) => {
      if (reflective) return;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          if (m.metalness >= 0.35 || m.roughness <= 0.25) {
            reflective = true;
            break;
          }
        }
      }
    });
    return reflective;
  }

  private applyEnvMapToObject(obj: THREE.Object3D, envMap: THREE.Texture | null): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m instanceof THREE.MeshStandardMaterial) {
          const hadEnv = m.envMap !== null;
          const nextHasEnv = envMap !== null;
          m.envMap = envMap;
          m.envMapIntensity = 1;
          if (hadEnv !== nextHasEnv) {
            m.needsUpdate = true;
          }
        }
      }
    });
  }

  private disposeProbe(nodeId: string): void {
    const probe = this.reflectionProbes.get(nodeId);
    if (!probe) return;
    probe.cubeTarget.dispose();
    probe.pmremTarget?.dispose();
    this.reflectionProbes.delete(nodeId);
  }

  private updateReflectionProbes(): void {
    this.probesDirty = false;
    if (this.disposed) return;

    // Clean up probes for removed or non-reflective objects first
    for (const [nodeId, probe] of Array.from(this.reflectionProbes.entries())) {
      const obj = this.nodeObjects.get(nodeId);
      if (!obj || !this.isNodeReflective(obj)) {
        if (obj) this.applyEnvMapToObject(obj, null);
        probe.cubeTarget.dispose();
        probe.pmremTarget?.dispose();
        this.reflectionProbes.delete(nodeId);
      }
    }

    const reflectiveNodes: Array<[string, THREE.Object3D]> = [];
    for (const [nodeId, obj] of this.nodeObjects.entries()) {
      if (this.isNodeReflective(obj)) {
        reflectiveNodes.push([nodeId, obj]);
      } else if (!obj.userData.isLightNode) {
        this.applyEnvMapToObject(obj, null);
      }
    }

    if (reflectiveNodes.length === 0) return;

    // Hide technical editor helpers during reflection capture
    const prevGizmo = this.gizmoHelper.visible;
    const prevBox = this.selectionBox?.visible ?? false;
    const prevLightHelpers: Array<{ obj: THREE.Object3D; visible: boolean }> = [];
    for (const obj of this.nodeObjects.values()) {
      if (!obj.userData.isLightNode) continue;
      for (const key of ['proxyMesh', 'rangeHelper'] as const) {
        const helper = obj.userData[key] as THREE.Object3D | undefined;
        if (helper) {
          prevLightHelpers.push({ obj: helper, visible: helper.visible });
          helper.visible = false;
        }
      }
    }
    this.gizmoHelper.visible = false;
    if (this.selectionBox) this.selectionBox.visible = false;

    const probeRes = this.isSoftwareGl ? 64 : 256;
    const prevShadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;

    for (const [nodeId, obj] of reflectiveNodes) {
      let probe = this.reflectionProbes.get(nodeId);
      if (!probe) {
        const cubeTarget = new THREE.WebGLCubeRenderTarget(probeRes, {
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
        });
        const cubeCamera = new THREE.CubeCamera(0.1, 150, cubeTarget);
        probe = { cubeTarget, cubeCamera, pmremTarget: null };
        this.reflectionProbes.set(nodeId, probe);
      }

      obj.updateMatrixWorld(true);
      _probeBox.setFromObject(obj);
      if (!_probeBox.isEmpty()) {
        _probeBox.getCenter(_probeCenter);
      } else {
        obj.getWorldPosition(_probeCenter);
      }
      probe.cubeCamera.position.copy(_probeCenter);

      obj.visible = false;
      probe.cubeCamera.update(this.renderer, this.scene);
      obj.visible = true;

      probe.pmremTarget?.dispose();
      probe.pmremTarget = this.pmremGenerator.fromCubemap(probe.cubeTarget.texture);
      this.applyEnvMapToObject(obj, probe.pmremTarget.texture);
    }

    this.renderer.shadowMap.autoUpdate = prevShadowAutoUpdate;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setRenderTarget(null);
    this.gizmoHelper.visible = prevGizmo;
    if (this.selectionBox) this.selectionBox.visible = prevBox;
    for (const item of prevLightHelpers) {
      item.obj.visible = item.visible;
    }
  }

  public removeNode(nodeId: string): void {
    const obj = this.nodeObjects.get(nodeId);
    if (!obj) return;

    if (this.transformControls.object === obj) {
      this.transformControls.detach();
      this.gizmoHelper.visible = false;
    }
    if (this.selectedNodeId === nodeId && this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.dispose();
      this.selectionBox = null;
    }

    const lightTarget = obj.userData?.lightTarget as THREE.Object3D | undefined;
    if (lightTarget) {
      this.scene.remove(lightTarget);
    }

    this.disposeProbe(nodeId);
    this.scene.remove(obj);
    disposeObjectResources(obj);
    this.nodeObjects.delete(nodeId);
    this.probesDirty = true;
    this.notifyPathTracerInteraction({ scene: true });
    this.requestRender();
  }

  public clearAllNodes(): void {
    for (const id of Array.from(this.nodeObjects.keys())) {
      this.removeNode(id);
    }
    this.selectedNodeId = null;
  }

  public exportSnapshotPng(): string {
    if (
      this.isPathTracerEnabled() &&
      this.pathTracer &&
      this.pathTracer.samples > 0 &&
      !this.pathTracerInteracting
    ) {
      const pt = this.pathTracer;
      return this.withPathTracerSceneState(() => {
        const prevPause = pt.pausePathTracing;
        pt.pausePathTracing = true;
        pt.renderSample();
        const url = this.renderer.domElement.toDataURL('image/png');
        pt.pausePathTracing = prevPause;
        return url;
      });
    }

    if (this.probesDirty) {
      this.updateReflectionProbes();
    }
    const prevGizmo = this.gizmoHelper.visible;
    const prevBox = this.selectionBox?.visible ?? false;
    const prevRanges: Array<{ helper: THREE.Object3D; visible: boolean }> = [];
    for (const obj of this.nodeObjects.values()) {
      const rangeHelper = obj.userData?.rangeHelper as THREE.Object3D | undefined;
      if (rangeHelper) {
        prevRanges.push({ helper: rangeHelper, visible: rangeHelper.visible });
        rangeHelper.visible = false;
      }
    }
    this.gizmoHelper.visible = false;
    if (this.selectionBox) this.selectionBox.visible = false;

    this.renderer.render(this.scene, this.camera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    this.gizmoHelper.visible = prevGizmo;
    if (this.selectionBox) this.selectionBox.visible = prevBox;
    for (const item of prevRanges) {
      item.helper.visible = item.visible;
    }
    this.requestRender();
    return dataUrl;
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.timerId);
    clearTimeout(this.pathTracerIdleTimer);
    this.resizeObserver.disconnect();

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    dom.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.clearAllNodes();
    for (const id of Array.from(this.reflectionProbes.keys())) {
      this.disposeProbe(id);
    }
    this.pathTracer?.dispose();
    this.pathTracer = null;
    this.pathTracerEnvTexture?.dispose();
    this.pathTracerEnvTexture = null;
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.dracoLoader.dispose();
    this.envRenderTarget.dispose();
    this.pmremGenerator.dispose();
    this.gridHelper.geometry.dispose();
    (this.gridHelper.material as THREE.Material).dispose();
    this.axesHelper.geometry.dispose();
    (this.axesHelper.material as THREE.Material).dispose();
    this.shadowCatcher.geometry.dispose();
    (this.shadowCatcher.material as THREE.Material).dispose();
    this.renderer.dispose();

    if (dom.parentElement === this.container) {
      this.container.removeChild(dom);
    }
  }
}
