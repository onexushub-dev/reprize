import { Directory, File, Paths } from 'expo-file-system';

/** The folder of a received recording's files (sharing design §5.5). */
export function receivedDir(shareId: string): Directory {
  return new Directory(Paths.document, 'received', shareId);
}

/**
 * Deletes everything a received recording kept on the phone (its clips' stills, files left by a stopped download).
 * Called when the recording itself is deleted; best effort.
 */
export function removeReceivedFiles(shareId: string): void {
  try {
    const dir = receivedDir(shareId);
    if (dir.exists) dir.delete();
  } catch {
    // already gone
  }
}

/** Where a received clip's video lives, as a plain path; its still is `thumbnailPath` of it. Creates nothing. */
export function receivedVideoPath(shareId: string, position: number): string {
  return decodeURIComponent(new File(receivedDir(shareId), `${position}.mp4`).uri.replace(/^file:\/\//, ''));
}
