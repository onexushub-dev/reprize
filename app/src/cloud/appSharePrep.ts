import { Directory, File } from 'expo-file-system';
import { AppState } from 'react-native';

import { cutClip, withBackgroundTime } from '../../modules/replay-camera';
import { diag } from '../diag/diagLog';
import { uploadQueue } from './appUploadQueue';
import { createSharePrep } from './sharePrep';
import { plannedShares, prepJobsOf, saveUploadPlan, setPrepJobs, shareFilesDir, uploadPlan } from './uploadPlan';

function plain(file: File): string {
  return decodeURIComponent(file.uri.replace(/^file:\/\//, ''));
}

/** The app's preparation of shared files (`sharePrep.ts`): each clip's cut and framing files, before their uploads. */
export const sharePrep = createSharePrep({
  shares: plannedShares,
  jobs: { get: prepJobsOf, set: setPrepJobs },
  plan: { get: uploadPlan, save: saveUploadPlan },
  cut: (source, out, startMs, endMs, muted) => cutClip(source, out, startMs, endMs, muted),
  exists: (path) => {
    try {
      return new File(`file://${path}`).exists;
    } catch {
      return false;
    }
  },
  readText: (path) => {
    try {
      return new File(`file://${path}`).textSync();
    } catch {
      return undefined;
    }
  },
  writeText: (path, text) => {
    const file = new File(`file://${path}`);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
  },
  // "shares/<share>/clips/3/video.mp4" → "<share folder>/clips/3-video.mp4"
  outPath: (shareId, job) => {
    const parts = job.id.split('/');
    const name = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`;
    const dir = new Directory(shareFilesDir(shareId), 'clips');
    dir.create({ intermediates: true, idempotent: true });
    return plain(new File(dir, name));
  },
  sync: () => uploadQueue.sync(),
  log: diag,
  background: (work) => withBackgroundTime('reprize.sharePrep', work),
});

/** Makes what is waiting at launch and each time the app comes back to the front. Returns the cleanup. */
export function startSharePrep(): () => void {
  void sharePrep.run();
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') void sharePrep.run();
  });
  return () => sub.remove();
}
