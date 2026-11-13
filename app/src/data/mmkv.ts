import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { createMMKV } from 'react-native-mmkv';

import { withoutSavedZoom } from '../modes/registry';
import { ballDetPath, ballPath } from './ballFile';
import { focusPath, peoplePath } from './focusFile';
import { createRepo, type FileProbe, type KV } from './repo';
import { thumbnailPath } from './thumbnailPath';

const storage = createMMKV({ id: 'reprize' });

export const kv: KV = {
  getString: (k) => storage.getString(k),
  set: (k, v) => storage.set(k, v),
  delete: (k) => void storage.remove(k),
  keys: () => storage.getAllKeys(),
};

/** Clip paths are absolute filesystem paths from the native module. */
export const files: FileProbe = {
  exists: (path) => new File(`file://${path}`).exists,
  sizeBytes: (path) => new File(`file://${path}`).size ?? 0,
};

export const repo = createRepo(kv, files, randomUUID);

// Once per launch: the zoom picked last time is forgotten, so the camera opens at 1x (modes/zoom: DEFAULT_ZOOM).
try {
  const reset = withoutSavedZoom(repo.getPrefs());
  if (reset !== undefined) repo.setPrefs(reset);
} catch {
  // the zoom picked last time stays; nothing else depends on this
}

// Once per launch, before any screen reads the list: a recording left open by a closed app gets its end.
try {
  repo.closeOpenSessions();
} catch {
  // it stays open until the next launch
}

/** A `file://` folder address as a plain path ending in '/'. */
export function documentsPath(uri: string): string {
  const path = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  return path.endsWith('/') ? path : path + '/';
}

// iOS can move the app's data folder on reinstall: point the clips back to where their files are now.
try {
  repo.relocateClips(documentsPath(Paths.document.uri));
} catch {
  // no file system here (tests, web): nothing to move
}

// The cut suggestion is gone (2026-11-01): clips it had cut go back to the cut they were saved with.
try {
  repo.forgetCutSuggestions();
} catch {
  // a cleanup never stops the app from opening
}

const removalListeners = new Set<(clipPath: string) => void>();

/** Hears every clip file about to be deleted (the Modo Foco queue stops its analysis). Returns the unsubscribe. */
export function onFileRemoved(listener: (clipPath: string) => void): () => void {
  removalListeners.add(listener);
  return () => void removalListeners.delete(listener);
}

/**
 * Deletes a saved clip's file, its cached thumbnail, its Modo Foco framing and its Seguir a Bola files; files already
 * gone are the goal.
 */
export function removeFile(path: string): void {
  removalListeners.forEach((listener) => listener(path));
  // The last one is where thumbnails were kept before they were checked for being black.
  const own = [path, thumbnailPath(path), path.replace(/\.[^./]+$/, '') + '.jpg', focusPath(path), peoplePath(path), ballPath(path), ballDetPath(path)];
  for (const p of own) {
    try {
      new File(`file://${p}`).delete();
    } catch {
      // already gone
    }
  }
}
