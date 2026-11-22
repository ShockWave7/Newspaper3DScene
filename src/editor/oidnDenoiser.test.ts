import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseTZA, type UNet } from 'oidn-webgpu';
import {
  OidnDenoiserService,
  createInitialDenoiserStatus,
  flipGlRgbaBottomUpToClamped,
} from './oidnDenoiser';
import type { DenoiserStatus } from './types';

function createMockCanvas(width = 64, height = 64) {
  const putCalls: Array<{ x: number; y: number }> = [];
  const canvas = {
    width,
    height,
    getContext: (type: string) =>
      type === '2d'
        ? {
            putImageData: (_data: ImageData, x: number, y: number) => {
              putCalls.push({ x, y });
            },
          }
        : null,
  };
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    putCalls,
  };
}

function createFakeImageData(width = 64, height = 64): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  } as ImageData;
}

test('bundled local OIDN LDR weights file parses cleanly via parseTZA', () => {
  const weightsPath = path.resolve(process.cwd(), 'public/weights/rt_ldr.tza');
  assert.ok(fs.existsSync(weightsPath), 'public/weights/rt_ldr.tza must exist');
  const buf = fs.readFileSync(weightsPath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = parseTZA(arrayBuffer);
  assert.ok(parsed.size >= 20, `expected >= 20 tensors in rt_ldr.tza, got ${parsed.size}`);
});

test('OidnDenoiserService reports unsupported cleanly when WebGPU adapter is unavailable', async () => {
  const events: DenoiserStatus[] = [];
  let loadCalled = false;
  const service = new OidnDenoiserService((s) => events.push({ ...s }), {
    probeWebGpu: async () => false,
    loadUnet: async () => {
      loadCalled = true;
      throw new Error('should not load');
    },
    captureImageData: () => createFakeImageData(),
  });

  const src = createMockCanvas().canvas;
  const overlay = createMockCanvas().canvas;
  const ok = await service.denoiseCanvas(src, overlay);

  assert.equal(ok, false);
  assert.equal(loadCalled, false);
  assert.equal(service.getStatus().phase, 'unsupported');
  assert.equal(service.getStatus().hasResult, false);
  assert.ok(events.some((e) => e.phase === 'unsupported'));
});

test('OidnDenoiserService runs loading-model -> denoising -> ready, caches UNet, and toggles view modes', async () => {
  const events: DenoiserStatus[] = [];
  let loadCount = 0;
  let loadedUrl = '';
  let disposed = false;

  const fakeUnet = {
    tileExecute: (opts: {
      color: ImageData;
      progress?: (
        output: ImageData,
        tileData: ImageData,
        tile: { x: number; y: number; width: number; height: number },
        idx: number,
        total: number,
      ) => void;
      done?: (output: ImageData) => void;
    }) => {
      const tileImg = createFakeImageData(32, 64);
      const outImg = createFakeImageData(64, 64);
      queueMicrotask(() => {
        opts.progress?.(outImg, tileImg, { x: 0, y: 0, width: 32, height: 64 }, 0, 2);
        opts.progress?.(outImg, tileImg, { x: 32, y: 0, width: 32, height: 64 }, 1, 2);
        opts.done?.(outImg);
      });
      return () => {};
    },
    dispose: () => {
      disposed = true;
    },
  } as unknown as UNet;

  const service = new OidnDenoiserService((s) => events.push({ ...s }), {
    probeWebGpu: async () => true,
    loadUnet: async (url) => {
      loadCount += 1;
      loadedUrl = url;
      return fakeUnet;
    },
    captureImageData: () => createFakeImageData(64, 64),
  });

  assert.deepEqual(service.getStatus(), createInitialDenoiserStatus());

  const src = createMockCanvas(64, 64).canvas;
  const overlayMock = createMockCanvas(64, 64);

  const ok1 = await service.denoiseCanvas(src, overlayMock.canvas);
  assert.equal(ok1, true);
  assert.equal(loadedUrl, '/weights/rt_ldr.tza');
  assert.equal(loadCount, 1);
  assert.equal(service.getStatus().phase, 'ready');
  assert.equal(service.getStatus().progress, 1);
  assert.equal(service.getStatus().hasResult, true);
  assert.equal(service.getStatus().viewMode, 'denoised');
  assert.deepEqual(
    events.map((e) => e.phase),
    ['loading-model', 'denoising', 'denoising', 'denoising', 'ready'],
  );
  assert.equal(events[2].progress, 0.5);
  assert.equal(events[3].progress, 1);
  // Seed frame + 2 tiles + final composite
  assert.equal(overlayMock.putCalls.length, 4);

  // Switch between Original and Denoised
  service.setViewMode('original');
  assert.equal(service.getStatus().viewMode, 'original');
  service.setViewMode('denoised');
  assert.equal(service.getStatus().viewMode, 'denoised');

  // Second run reuses cached UNet without reloading weights
  events.length = 0;
  const ok2 = await service.denoiseCanvas(src, overlayMock.canvas);
  assert.equal(ok2, true);
  assert.equal(loadCount, 1);
  assert.equal(events[0].phase, 'denoising');
  assert.equal(events[events.length - 1].phase, 'ready');

  service.cancel();
  assert.equal(service.getStatus().phase, 'idle');
  assert.equal(service.getStatus().hasResult, false);

  service.dispose();
  assert.equal(disposed, true);
});

test('OidnDenoiserService aborts active tile execution when cancelled mid-run', async () => {
  let aborted = false;
  const tileDone: { run?: () => void } = {};

  const fakeUnet = {
    tileExecute: (opts: { done?: (output: ImageData) => void }) => {
      tileDone.run = () => opts.done?.(createFakeImageData(64, 64));
      return () => {
        aborted = true;
      };
    },
    dispose: () => {},
  } as unknown as UNet;

  const service = new OidnDenoiserService(undefined, {
    probeWebGpu: async () => true,
    loadUnet: async () => fakeUnet,
    captureImageData: () => createFakeImageData(64, 64),
  });

  const promise = service.denoiseCanvas(
    createMockCanvas(64, 64).canvas,
    createMockCanvas(64, 64).canvas,
  );
  // Wait for ensureUnet() microtask to start tileExecute
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(service.getStatus().phase, 'denoising');

  service.cancel();
  assert.equal(aborted, true);
  assert.equal(service.getStatus().phase, 'idle');

  // Late done callback from cancelled run must resolve false and stay idle
  tileDone.run?.();
  const ok = await promise;
  assert.equal(ok, false);
  assert.equal(service.getStatus().phase, 'idle');
});

test('OidnDenoiserService handles model load failures gracefully', async () => {
  const service = new OidnDenoiserService(undefined, {
    probeWebGpu: async () => true,
    loadUnet: async () => {
      throw new Error('Ошибка сети при загрузке весов');
    },
    captureImageData: () => createFakeImageData(64, 64),
  });

  const ok = await service.denoiseCanvas(
    createMockCanvas(64, 64).canvas,
    createMockCanvas(64, 64).canvas,
  );
  assert.equal(ok, false);
  assert.equal(service.getStatus().phase, 'error');
  assert.equal(service.getStatus().errorMessage, 'Ошибка сети при загрузке весов');
});

test('flipGlRgbaBottomUpToClamped flips rows vertically and clamps alpha to 255', () => {
  // 2x2 image: bottom row (y=0 in WebGL) is red/green; top row (y=1 in WebGL) is blue/white
  const glBytes = new Uint8Array([
    255, 10, 20, 0,   30, 255, 40, 128, // bottom row
    50, 60, 255, 10,  240, 241, 242, 0, // top row
  ]);
  const topDown = flipGlRgbaBottomUpToClamped(glBytes, 2, 2);
  assert.deepEqual(
    Array.from(topDown),
    [
      50, 60, 255, 255,  240, 241, 242, 255, // top row first
      255, 10, 20, 255,  30, 255, 40, 255,   // bottom row second
    ],
  );
});

test('OidnDenoiserService.denoiseImageData processes 1:1 native ImageData and writes distinct denoised pixels to overlayCanvas', async () => {
  const writes: ImageData[] = [];
  const overlayCanvas = {
    width: 100,
    height: 100,
    getContext: (type: string) =>
      type === '2d'
        ? {
            putImageData: (data: ImageData) => {
              writes.push(data);
            },
          }
        : null,
  } as unknown as HTMLCanvasElement;

  const noisyImage = createFakeImageData(48, 36);
  noisyImage.data[0] = 250;
  noisyImage.data[1] = 10;
  noisyImage.data[2] = 5;
  noisyImage.data[3] = 255;

  let receivedColor: ImageData | null = null;
  const fakeUnet = {
    tileExecute: (opts: {
      color: ImageData;
      done?: (output: ImageData) => void;
    }) => {
      receivedColor = opts.color;
      const denoised = createFakeImageData(opts.color.width, opts.color.height);
      denoised.data[0] = 120;
      denoised.data[1] = 120;
      denoised.data[2] = 120;
      denoised.data[3] = 255;
      queueMicrotask(() => opts.done?.(denoised));
      return () => {};
    },
    dispose: () => {},
  } as unknown as UNet;

  const service = new OidnDenoiserService(undefined, {
    probeWebGpu: async () => true,
    loadUnet: async () => fakeUnet,
  });

  const ok = await service.denoiseImageData(noisyImage, overlayCanvas);
  assert.equal(ok, true);
  assert.equal(receivedColor, noisyImage);
  assert.equal(overlayCanvas.width, 48);
  assert.equal(overlayCanvas.height, 36);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].data[0], 250);
  assert.equal(writes[1].data[0], 120);
  assert.equal(service.getStatus().phase, 'ready');
  assert.equal(service.getStatus().hasResult, true);
});
