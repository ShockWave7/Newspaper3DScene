import { initUNetFromURL, type UNet } from 'oidn-webgpu';
import type { DenoiserStatus, DenoiserViewMode } from './types';

const DEFAULT_WEIGHTS_URL = '/weights/rt_ldr.tza';

export async function probeWebGpuAvailability(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return false;
  }
  if (typeof navigator.gpu.requestAdapter !== 'function') {
    return false;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export function createInitialDenoiserStatus(): DenoiserStatus {
  return {
    phase: 'idle',
    progress: 0,
    viewMode: 'denoised',
    hasResult: false,
  };
}

export function flipGlRgbaBottomUpToClamped(
  rgbaBottomUp: Uint8Array,
  width: number,
  height: number,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const rowStride = width * 4;
  const result = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOffset = (height - 1 - y) * rowStride;
    const dstOffset = y * rowStride;
    for (let x = 0; x < rowStride; x += 4) {
      result[dstOffset + x] = rgbaBottomUp[srcOffset + x];
      result[dstOffset + x + 1] = rgbaBottomUp[srcOffset + x + 1];
      result[dstOffset + x + 2] = rgbaBottomUp[srcOffset + x + 2];
      result[dstOffset + x + 3] = 255;
    }
  }
  return result;
}

export function createImageDataFromGlRgba(
  rgbaBottomUp: Uint8Array,
  width: number,
  height: number,
): ImageData {
  const imageData = new ImageData(width, height);
  flipGlRgbaBottomUpToClamped(rgbaBottomUp, width, height, imageData.data);
  return imageData;
}

export interface DenoiserDeps {
  probeWebGpu: () => Promise<boolean>;
  loadUnet: (url: string) => Promise<UNet>;
  captureImageData: (canvas: HTMLCanvasElement) => ImageData | null;
}

export class OidnDenoiserService {
  private unet: UNet | null = null;
  private loadingPromise: Promise<UNet> | null = null;
  private webGpuSupported: boolean | null = null;
  private activeAbort: (() => void) | null = null;
  private runGeneration = 0;
  private disposed = false;

  private scratchCanvas: HTMLCanvasElement | null = null;
  private scratchCtx: CanvasRenderingContext2D | null = null;

  private status: DenoiserStatus = createInitialDenoiserStatus();
  private onStatusChange?: (status: DenoiserStatus) => void;
  private deps: DenoiserDeps;

  constructor(onStatusChange?: (status: DenoiserStatus) => void, deps?: Partial<DenoiserDeps>) {
    this.onStatusChange = onStatusChange;
    this.deps = {
      probeWebGpu: deps?.probeWebGpu ?? probeWebGpuAvailability,
      loadUnet: deps?.loadUnet ?? ((url) => initUNetFromURL(url, undefined, {})),
      captureImageData: deps?.captureImageData ?? ((canvas) => this.defaultCaptureImageData(canvas)),
    };
  }

  public getStatus(): DenoiserStatus {
    return this.status;
  }

  public setViewMode(viewMode: DenoiserViewMode): DenoiserStatus {
    if (this.status.viewMode === viewMode) return this.status;
    this.status = { ...this.status, viewMode };
    this.emitStatus();
    return this.status;
  }

  public captureFromCanvas(sourceCanvas: HTMLCanvasElement): ImageData | null {
    if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      return null;
    }
    return this.deps.captureImageData(sourceCanvas);
  }

  public cancel(): void {
    this.runGeneration += 1;
    if (this.activeAbort) {
      try {
        this.activeAbort();
      } catch {
        // Ignore abort cleanup errors
      }
      this.activeAbort = null;
    }
    if (
      this.status.phase !== 'idle' ||
      this.status.hasResult ||
      this.status.progress !== 0 ||
      this.status.errorMessage
    ) {
      this.status = {
        phase: 'idle',
        progress: 0,
        viewMode: this.status.viewMode,
        hasResult: false,
      };
      this.emitStatus();
    }
  }

  public async denoiseCanvas(
    sourceCanvas: HTMLCanvasElement,
    overlayCanvas: HTMLCanvasElement,
  ): Promise<boolean> {
    if (this.disposed) return false;
    if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
      return false;
    }

    const noisyImage = this.captureFromCanvas(sourceCanvas);
    if (!noisyImage) {
      this.abortActiveExecution();
      this.status = {
        phase: 'error',
        progress: 0,
        viewMode: this.status.viewMode,
        hasResult: false,
        errorMessage: 'Не удалось прочитать кадр рендера для денойзинга.',
      };
      this.emitStatus();
      return false;
    }

    return this.denoiseImageData(noisyImage, overlayCanvas);
  }

  public async denoiseImageData(
    noisyImage: ImageData,
    overlayCanvas: HTMLCanvasElement,
  ): Promise<boolean> {
    if (this.disposed) return false;

    const width = noisyImage.width;
    const height = noisyImage.height;
    if (width <= 0 || height <= 0) {
      return false;
    }

    // Cancel any previous in-flight run first
    this.abortActiveExecution();
    const gen = this.runGeneration;

    // Check WebGPU availability once and cache result
    if (this.webGpuSupported === null) {
      this.webGpuSupported = await this.deps.probeWebGpu();
      if (this.disposed || gen !== this.runGeneration) return false;
    }

    if (!this.webGpuSupported) {
      this.status = {
        phase: 'unsupported',
        progress: 0,
        viewMode: this.status.viewMode,
        hasResult: false,
        errorMessage: 'WebGPU недоступен в этом браузере или на текущем GPU.',
      };
      this.emitStatus();
      return false;
    }

    // Lazy-load and compile OIDN U-Net weights from local static asset
    let unet = this.unet;
    if (!unet) {
      this.status = {
        phase: 'loading-model',
        progress: 0,
        viewMode: this.status.viewMode,
        hasResult: false,
      };
      this.emitStatus();

      try {
        unet = await this.ensureUnet();
      } catch (err) {
        if (this.disposed || gen !== this.runGeneration) return false;
        this.status = {
          phase: 'error',
          progress: 0,
          viewMode: this.status.viewMode,
          hasResult: false,
          errorMessage: err instanceof Error ? err.message : 'Ошибка загрузки модели OIDN.',
        };
        this.emitStatus();
        return false;
      }
    }

    if (this.disposed || gen !== this.runGeneration) return false;

    // Prepare overlay 2D canvas at exact 1:1 native image dimensions and seed with original frame
    if (overlayCanvas.width !== width || overlayCanvas.height !== height) {
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }
    const overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) {
      this.status = {
        phase: 'error',
        progress: 0,
        viewMode: this.status.viewMode,
        hasResult: false,
        errorMessage: 'Не удалось инициализировать 2D-контекст для вывода денойза.',
      };
      this.emitStatus();
      return false;
    }
    overlayCtx.putImageData(noisyImage, 0, 0);

    this.status = {
      phase: 'denoising',
      progress: 0,
      viewMode: this.status.viewMode,
      hasResult: false,
    };
    this.emitStatus();

    return new Promise<boolean>((resolve) => {
      try {
        const abort = unet.tileExecute({
          color: noisyImage,
          scheduling: 'animation-frame',
          progress: (_output, tileData, tile, currentIdx, totalIdx) => {
            if (this.disposed || gen !== this.runGeneration) return;
            if (tileData) {
              overlayCtx.putImageData(tileData, tile.x, tile.y);
            }
            const frac = totalIdx > 0 ? Math.min(1, (currentIdx + 1) / totalIdx) : 0;
            this.status = {
              phase: 'denoising',
              progress: frac,
              viewMode: this.status.viewMode,
              hasResult: false,
            };
            this.emitStatus();
          },
          done: (denoisedData) => {
            this.activeAbort = null;
            if (this.disposed || gen !== this.runGeneration) {
              resolve(false);
              return;
            }
            overlayCtx.putImageData(denoisedData, 0, 0);
            this.status = {
              phase: 'ready',
              progress: 1,
              viewMode: this.status.viewMode,
              hasResult: true,
            };
            this.emitStatus();
            resolve(true);
          },
          error: (reason) => {
            this.activeAbort = null;
            if (this.disposed || gen !== this.runGeneration) {
              resolve(false);
              return;
            }
            this.status = {
              phase: 'error',
              progress: 0,
              viewMode: this.status.viewMode,
              hasResult: false,
              errorMessage:
                reason instanceof Error ? reason.message : 'Ошибка выполнения OIDN WebGPU.',
            };
            this.emitStatus();
            resolve(false);
          },
        });
        this.activeAbort = abort;
      } catch (err) {
        this.activeAbort = null;
        if (!this.disposed && gen === this.runGeneration) {
          this.status = {
            phase: 'error',
            progress: 0,
            viewMode: this.status.viewMode,
            hasResult: false,
            errorMessage:
              err instanceof Error ? err.message : 'Не удалось запустить OIDN WebGPU.',
          };
          this.emitStatus();
        }
        resolve(false);
      }
    });
  }

  private abortActiveExecution(): void {
    this.runGeneration += 1;
    if (this.activeAbort) {
      try {
        this.activeAbort();
      } catch {
        // Ignore abort cleanup errors
      }
      this.activeAbort = null;
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.cancel();
    if (this.unet) {
      try {
        this.unet.dispose();
      } catch {
        // Ignore dispose errors
      }
      this.unet = null;
    }
    this.loadingPromise = null;
    this.scratchCanvas = null;
    this.scratchCtx = null;
  }

  private async ensureUnet(): Promise<UNet> {
    if (this.unet) return this.unet;
    if (!this.loadingPromise) {
      this.loadingPromise = this.deps
        .loadUnet(DEFAULT_WEIGHTS_URL)
        .then((instance) => {
          if (this.disposed) {
            instance.dispose();
            throw new Error('Denoiser disposed');
          }
          this.unet = instance;
          return instance;
        })
        .catch((err) => {
          this.loadingPromise = null;
          throw err;
        });
    }
    return this.loadingPromise;
  }

  private defaultCaptureImageData(sourceCanvas: HTMLCanvasElement): ImageData | null {
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
      this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.scratchCanvas || !this.scratchCtx) return null;

    if (this.scratchCanvas.width !== width || this.scratchCanvas.height !== height) {
      this.scratchCanvas.width = width;
      this.scratchCanvas.height = height;
    }
    this.scratchCtx.clearRect(0, 0, width, height);
    this.scratchCtx.drawImage(sourceCanvas, 0, 0, width, height);
    return this.scratchCtx.getImageData(0, 0, width, height);
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.status);
  }
}
