import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  clamp,
  classifySceneLights,
  createDefaultPathTracerSettings,
  createDefaultSceneSettings,
  createEmptyProject,
  createGlbNode,
  createLightNode,
  createPrimitiveNode,
  createStarterProject,
  degToRad,
  deserializeProject,
  duplicateNode,
  hasActiveSceneLights,
  radToDeg,
  resolveViewportLighting,
  roundTo,
  serializeProject,
  snapValue,
} from './sceneModel';

test('angle and snapping math helpers behave deterministically', () => {
  assert.equal(roundTo(degToRad(180), 4), roundTo(Math.PI, 4));
  assert.equal(roundTo(radToDeg(Math.PI / 2), 2), 90);
  assert.equal(snapValue(1.37, 0.25), 1.25);
  assert.equal(snapValue(1.38, 0.25), 1.5);
  assert.equal(snapValue(-0.0001, 0.5), 0);
  assert.equal(clamp(1.8, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(Number.NaN, 0.2, 1), 0.2);
});

test('starter project creates grounded multi-object studio scene', () => {
  const starter = createStarterProject();
  assert.equal(starter.version, 1);
  assert.ok(starter.nodes.length >= 5);
  const meshes = starter.nodes.filter((n) => n.kind === 'primitive');
  const lights = starter.nodes.filter((n) => n.kind === 'light');
  assert.ok(meshes.length >= 3);
  assert.ok(lights.length >= 2);
});

test('node duplication creates unique ID and offsets position', () => {
  const box = createPrimitiveNode('box', { name: 'Тестовый куб', position: { x: 1, y: 0.5, z: -2 } });
  const copy = duplicateNode(box);

  assert.notEqual(copy.id, box.id);
  assert.equal(copy.name, 'Тестовый куб (копия)');
  assert.equal(copy.transform.position.x, 2.2);
  assert.equal(copy.transform.position.y, 0.5);
  assert.equal(copy.transform.position.z, -2);

  // Mutating copy must not mutate original
  copy.material!.color = '#ff0000';
  assert.notEqual(box.material!.color, '#ff0000');
});

test('project serialization and deserialization round-trips primitives, lights, and embedded GLB assets', () => {
  const project = createEmptyProject('Экспортный проект');
  const sphere = createPrimitiveNode('sphere', {
    material: { color: '#ef4444', roughness: 0.2, metalness: 0.8 },
  });
  const spot = createLightNode('spot', {
    position: { x: 0, y: 6, z: 3 },
  });
  const glb = createGlbNode('asset_abc', {
    fileName: 'robot.glb',
    fileSizeBytes: 12,
    meshCount: 3,
    triangleCount: 420,
    boundsSize: { x: 1, y: 2, z: 1 },
  });

  const sampleBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]);
  const b64 = arrayBufferToBase64(sampleBytes.buffer);

  project.nodes.push(sphere, spot, glb);
  project.embeddedAssets = {
    asset_abc: {
      fileName: 'robot.glb',
      base64: b64,
    },
  };

  const json = serializeProject(project);
  const restored = deserializeProject(json);

  assert.equal(restored.name, 'Экспортный проект');
  assert.equal(restored.nodes.length, 4);
  const restoredSphere = restored.nodes.find((n) => n.id === sphere.id);
  assert.equal(restoredSphere?.material?.color, '#ef4444');
  assert.equal(restoredSphere?.material?.metalness, 0.8);

  const restoredGlb = restored.nodes.find((n) => n.id === glb.id);
  assert.equal(restoredGlb?.glbMeta?.fileName, 'robot.glb');
  assert.ok(restored.embeddedAssets?.asset_abc);

  const decodedBuffer = base64ToArrayBuffer(restored.embeddedAssets!.asset_abc.base64);
  assert.deepEqual(Array.from(new Uint8Array(decodedBuffer)), Array.from(sampleBytes));
});

test('deserializeProject rejects invalid payloads safely', () => {
  assert.throws(() => deserializeProject('{bad json'), /Некорректный JSON/);
  assert.throws(() => deserializeProject('{"name":"no nodes"}'), /отсутствует список объектов/);
});

test('hasActiveSceneLights detects visible lights with positive intensity', () => {
  const box = createPrimitiveNode('box');
  const hiddenLight = createLightNode('point');
  hiddenLight.visible = false;
  const zeroLight = createLightNode('directional', { light: { intensity: 0 } });
  const activeLight = createLightNode('spot', { light: { intensity: 12 } });

  assert.equal(hasActiveSceneLights([box]), false);
  assert.equal(hasActiveSceneLights([box, hiddenLight, zeroLight]), false);
  assert.equal(hasActiveSceneLights([box, hiddenLight, activeLight]), true);
});

test('resolveViewportLighting blacks out render mode when no lights exist and keeps objects visible in objects mode', () => {
  const settings = createDefaultSceneSettings({
    backgroundColor: '#1e2430',
    fogEnabled: true,
    gridVisible: true,
    ambientIntensity: 0.75,
  });

  const renderNoLights = resolveViewportLighting('render', false, settings);
  assert.equal(renderNoLights.isPitchBlack, true);
  assert.equal(renderNoLights.backgroundColor, '#000000');
  assert.equal(renderNoLights.ambientIntensity, 0);
  assert.equal(renderNoLights.useEnvironment, false);
  assert.equal(renderNoLights.useWorkbenchLight, false);
  assert.equal(renderNoLights.gridVisible, false);

  const renderWithLights = resolveViewportLighting('render', true, settings);
  assert.equal(renderWithLights.isPitchBlack, false);
  assert.equal(renderWithLights.backgroundColor, '#1e2430');
  assert.ok(renderWithLights.ambientIntensity > 0 && renderWithLights.ambientIntensity < settings.ambientIntensity);
  assert.equal(renderWithLights.useEnvironment, true);
  assert.ok(renderWithLights.environmentIntensity > 0.3 && renderWithLights.environmentIntensity <= 0.65);
  assert.ok(renderWithLights.bounceFillIntensity > 0);
  assert.equal(renderWithLights.shadowsEnabled, true);

  const objectsNoLights = resolveViewportLighting('objects', false, settings);
  assert.equal(objectsNoLights.isPitchBlack, false);
  assert.equal(objectsNoLights.isDarkRender, false);
  assert.equal(objectsNoLights.useWorkbenchLight, true);
  assert.equal(objectsNoLights.useEnvironment, true);
  assert.equal(objectsNoLights.environmentIntensity, 1);
  assert.ok(objectsNoLights.ambientIntensity >= 0.85);
  assert.equal(objectsNoLights.shadowsEnabled, false);
  assert.equal(objectsNoLights.gridVisible, true);
});

test('classifySceneLights and resolveViewportLighting isolate local Point/Spot lights and scale fill with Sun intensity', () => {
  const settings = createDefaultSceneSettings({
    backgroundColor: '#1e2430',
    fogEnabled: true,
    gridVisible: true,
    ambientIntensity: 0.4,
  });

  const point = createLightNode('point');
  const spot = createLightNode('spot');
  const dimSun = createLightNode('directional', { light: { intensity: 0.24 } });
  const brightSun = createLightNode('directional', { light: { intensity: 2.4 } });

  assert.equal(point.light?.distance, 5.5);
  assert.equal(spot.light?.distance, 6);
  assert.equal(point.light?.decay, 2);
  assert.equal(spot.light?.decay, 2);
  assert.equal(point.light?.castShadow, true);
  assert.equal(spot.light?.castShadow, true);

  const localStatus = classifySceneLights([point, spot]);
  assert.equal(localStatus.hasAny, true);
  assert.equal(localStatus.hasDirectional, false);
  assert.equal(localStatus.hasLocalOnly, true);
  assert.equal(localStatus.maxDirectionalIntensity, 0);

  const localRender = resolveViewportLighting('render', localStatus, settings);
  assert.equal(localRender.isPitchBlack, false);
  assert.equal(localRender.isDarkRender, true);
  assert.equal(localRender.useEnvironment, false);
  assert.equal(localRender.environmentIntensity, 0);
  assert.equal(localRender.ambientIntensity, 0);
  assert.equal(localRender.backgroundColor, '#000000');
  assert.equal(localRender.fogEnabled, false);
  assert.equal(localRender.gridVisible, false);
  assert.equal(localRender.shadowsEnabled, true);

  const dimSunStatus = classifySceneLights([point, dimSun]);
  const dimRender = resolveViewportLighting('render', dimSunStatus, settings);
  const brightSunStatus = classifySceneLights([point, brightSun]);
  const brightRender = resolveViewportLighting('render', brightSunStatus, settings);

  assert.equal(brightSunStatus.hasDirectional, true);
  assert.equal(brightSunStatus.hasLocalOnly, false);
  assert.equal(brightRender.isDarkRender, false);
  assert.equal(brightRender.useEnvironment, true);
  assert.ok(dimRender.ambientIntensity > 0 && dimRender.ambientIntensity < brightRender.ambientIntensity * 0.2);
  assert.ok(dimRender.environmentIntensity > 0 && dimRender.environmentIntensity < brightRender.environmentIntensity * 0.2);

  assert.equal(brightSun.light?.shadowIntensity, 1);
  const softShadowSun = createLightNode('directional', {
    light: { intensity: 100, shadowIntensity: 0.35 },
  });
  assert.equal(softShadowSun.light?.intensity, 100);
  assert.equal(softShadowSun.light?.shadowIntensity, 0.35);
  const clampedSun = createLightNode('directional', {
    light: { shadowIntensity: 2.5 },
  });
  assert.equal(clampedSun.light?.shadowIntensity, 1);

  // Bounce GI settings: default 0.55, scales with Sun, stays 0 when Sun=0 or local-only
  assert.equal(settings.bounceIntensity, 0.55);
  assert.equal(createDefaultSceneSettings({ bounceIntensity: 4 }).bounceIntensity, 1.5);
  assert.equal(localRender.bounceFillIntensity, 0);

  const zeroBounceRender = resolveViewportLighting(
    'render',
    brightSunStatus,
    createDefaultSceneSettings({ bounceIntensity: 0 }),
  );
  const highBounceRender = resolveViewportLighting(
    'render',
    brightSunStatus,
    createDefaultSceneSettings({ bounceIntensity: 1.4 }),
  );
  assert.equal(zeroBounceRender.bounceFillIntensity, 0);
  assert.ok(highBounceRender.bounceFillIntensity > brightRender.bounceFillIntensity);
  assert.ok(highBounceRender.environmentIntensity > zeroBounceRender.environmentIntensity);
  assert.ok(highBounceRender.ambientIntensity > zeroBounceRender.ambientIntensity);

  const noSunHighBounce = resolveViewportLighting(
    'render',
    false,
    createDefaultSceneSettings({ bounceIntensity: 1.5 }),
  );
  assert.equal(noSunHighBounce.bounceFillIntensity, 0);
  assert.equal(noSunHighBounce.ambientIntensity, 0);
  assert.equal(noSunHighBounce.environmentIntensity, 0);
});

test('PathTracer settings default to standard engine, clamp options, and round-trip via JSON', () => {
  const defaults = createDefaultSceneSettings();
  assert.equal(defaults.renderEngine, 'standard');
  assert.deepEqual(defaults.pathTracer, {
    bounces: 5,
    maxSamples: 128,
    renderScale: 0.75,
    paused: false,
  });

  const clamped = createDefaultPathTracerSettings({
    bounces: 99,
    maxSamples: 2,
    renderScale: 0.1,
    paused: true,
  });
  assert.equal(clamped.bounces, 12);
  assert.equal(clamped.maxSamples, 8);
  assert.equal(clamped.renderScale, 0.25);
  assert.equal(clamped.paused, true);

  const project = createEmptyProject('PT тест');
  project.settings = createDefaultSceneSettings({
    renderEngine: 'pathtracer',
    pathTracer: {
      bounces: 8,
      maxSamples: 256,
      renderScale: 0.5,
      paused: true,
    },
  });

  const restored = deserializeProject(serializeProject(project));
  assert.equal(restored.settings.renderEngine, 'pathtracer');
  assert.deepEqual(restored.settings.pathTracer, {
    bounces: 8,
    maxSamples: 256,
    renderScale: 0.5,
    paused: true,
  });
});
