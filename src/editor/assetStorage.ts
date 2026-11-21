import { arrayBufferToBase64, base64ToArrayBuffer, deserializeProject, serializeProject } from './sceneModel';
import type { EmbeddedAssetMap, SavedProjectMeta, SceneProjectV1 } from './types';

const AUTO_PROJECT_KEY = 'forma3d.autosave.v1';
const SAVED_SLOTS_KEY = 'forma3d.projects.v1';
const IDB_NAME = 'forma3d_assets_db';
const IDB_STORE = 'glb_buffers';

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function openAssetDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB недоступен'));
      return;
    }
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть IndexedDB'));
  });
}

export async function saveAssetBuffer(assetId: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const db = await openAssetDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(buffer.slice(0), assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Не удалось сохранить GLB-буфер в IndexedDB:', err);
  }
}

export async function loadAssetBuffer(assetId: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openAssetDb();
    const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(assetId);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export function saveAutoProject(project: SceneProjectV1): void {
  if (!hasLocalStorage()) return;
  try {
    const cleanProject: SceneProjectV1 = { ...project, embeddedAssets: undefined };
    window.localStorage.setItem(AUTO_PROJECT_KEY, serializeProject(cleanProject));
  } catch (err) {
    console.warn('Ошибка автосохранения в localStorage:', err);
  }
}

export function loadAutoProject(): SceneProjectV1 | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(AUTO_PROJECT_KEY);
    if (!raw) return null;
    return deserializeProject(raw);
  } catch {
    return null;
  }
}

interface StoredSlotsRecord {
  [id: string]: SceneProjectV1;
}

function readSlotsRecord(): StoredSlotsRecord {
  if (!hasLocalStorage()) return {};
  try {
    const raw = window.localStorage.getItem(SAVED_SLOTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoredSlotsRecord) : {};
  } catch {
    return {};
  }
}

function writeSlotsRecord(record: StoredSlotsRecord): void {
  if (!hasLocalStorage()) return;
  window.localStorage.setItem(SAVED_SLOTS_KEY, JSON.stringify(record));
}

export function listProjectSlots(): SavedProjectMeta[] {
  const record = readSlotsRecord();
  return Object.values(record)
    .map((proj) => ({
      id: proj.id,
      name: proj.name,
      updatedAt: proj.updatedAt,
      nodeCount: Array.isArray(proj.nodes) ? proj.nodes.length : 0,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function saveProjectSlot(project: SceneProjectV1): SavedProjectMeta {
  const record = readSlotsRecord();
  const clean: SceneProjectV1 = {
    ...project,
    updatedAt: new Date().toISOString(),
    embeddedAssets: undefined,
  };
  record[clean.id] = clean;
  writeSlotsRecord(record);
  return {
    id: clean.id,
    name: clean.name,
    updatedAt: clean.updatedAt,
    nodeCount: clean.nodes.length,
  };
}

export function loadProjectSlot(projectId: string): SceneProjectV1 | null {
  const record = readSlotsRecord();
  const raw = record[projectId];
  if (!raw) return null;
  return deserializeProject(JSON.stringify(raw));
}

export function deleteProjectSlot(projectId: string): void {
  const record = readSlotsRecord();
  delete record[projectId];
  writeSlotsRecord(record);
}

export async function buildExportableProjectJson(project: SceneProjectV1): Promise<string> {
  const embeddedAssets: EmbeddedAssetMap = {};
  const glbNodes = project.nodes.filter((n) => n.kind === 'glb' && n.assetId);

  for (const node of glbNodes) {
    if (!node.assetId || embeddedAssets[node.assetId]) continue;
    const buffer = await loadAssetBuffer(node.assetId);
    if (buffer) {
      embeddedAssets[node.assetId] = {
        fileName: node.glbMeta?.fileName ?? `${node.name}.glb`,
        base64: arrayBufferToBase64(buffer),
      };
    }
  }

  return serializeProject({
    ...project,
    embeddedAssets: Object.keys(embeddedAssets).length > 0 ? embeddedAssets : undefined,
  });
}

export async function restoreEmbeddedAssetsToStorage(project: SceneProjectV1): Promise<void> {
  if (!project.embeddedAssets) return;
  const entries = Object.entries(project.embeddedAssets);
  for (const [assetId, asset] of entries) {
    if (asset?.base64) {
      const buf = base64ToArrayBuffer(asset.base64);
      await saveAssetBuffer(assetId, buf);
    }
  }
}
