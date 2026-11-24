import { useEffect, useState } from 'react';

import { File } from 'expo-file-system';

import { createThumbnail } from '../../modules/replay-camera';
import { thumbnailPath } from '../data/thumbnailPath';

const cache = new Map<string, string>();

/**
 * The frame the native side already wrote next to the clip (<clip>.thumb.jpg), found with a file check on the first
 * render: after the app opens, the grids drew empty tiles and filled them in one by one while each frame was asked for
 * again (2026-11-21).
 */
function onDisk(path: string): string | undefined {
  if (!path) return undefined;
  try {
    const uri = `file://${thumbnailPath(path)}`;
    return new File(uri).exists ? uri : undefined;
  } catch {
    return undefined;
  }
}

function cached(key: string, path: string): string | undefined {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const found = onDisk(path);
  if (found !== undefined) cache.set(key, found);
  return found;
}

/**
 * A frame of a saved clip, made natively once and cached as a .jpg next to the clip.
 * Returns a file uri for expo-image, or undefined while it is being made (or if it can't be).
 */
export function useClipThumbnail(path: string, atMs: number): string | undefined {
  const key = `${path}@${atMs}`;
  // Tagged with its key: a component whose clip changes (the export sheet gets one only when it opens) never shows the
  // last clip's frame, and a frame already cached for the new key is read straight from the cache.
  const [made, setMade] = useState<{ key: string; uri: string } | null>(null);

  useEffect(() => {
    if (!path || cached(key, path) !== undefined) return;
    let alive = true;
    createThumbnail(path, atMs)
      .then((thumbPath) => {
        const fileUri = `file://${thumbPath}`;
        cache.set(key, fileUri);
        if (alive) setMade({ key, uri: fileUri });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, path, atMs]);

  return cached(key, path) ?? (made !== null && made.key === key ? made.uri : undefined);
}
