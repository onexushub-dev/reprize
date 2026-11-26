import type { Quality, TriggerSource } from '../../modules/replay-camera/src/ReplayCamera.types';
import type { ModeSettings } from '../data/schema';
import { accessPlan } from './rules';
import type { Plan } from './types';

/** The free plan records at most this much per clip. */
export const FREE_MAX_SECONDS = 15;

export type CaptureConfig = { quality: Quality; bufferSeconds: number; cutSeconds: number; audio: boolean };

/**
 * What the camera runs with. The free plan records what the player chose, with sound, but keeps 15 s at most: sound is
 * locked when a clip leaves the app (export), so a Single Pass or Pro can still unlock a recording that is already
 * made. The 15 s ceiling cannot be given back later, so it stays at capture.
 */
export function captureConfig(settings: ModeSettings, plan: Plan): CaptureConfig {
  if (accessPlan(plan) === 'paid') {
    return { quality: settings.quality, bufferSeconds: settings.bufferSeconds, cutSeconds: settings.cutSeconds, audio: settings.audio };
  }
  return {
    // 4K is paid: the free plan records Full HD at 60 fps.
    quality: settings.quality === '2160p30' ? '1080p60' : settings.quality,
    bufferSeconds: Math.min(settings.bufferSeconds, FREE_MAX_SECONDS),
    cutSeconds: Math.min(settings.cutSeconds, FREE_MAX_SECONDS),
    audio: settings.audio,
  };
}

/** Recording in 4K is paid. */
export function qualityAllowed(quality: Quality, plan: Plan): boolean {
  return accessPlan(plan) === 'paid' || quality !== '2160p30';
}

/** The paid trigger: the Apple Watch. Voice, gesture, screen, the Bluetooth remote and the phone remote are free. */
export const PAID_TRIGGERS: readonly TriggerSource[] = ['watch'];

export function triggerAllowed(source: TriggerSource, plan: Plan): boolean {
  return accessPlan(plan) === 'paid' || !PAID_TRIGGERS.includes(source);
}

/** Compiling several clips into one video is paid. */
export function canCompile(plan: Plan): boolean {
  return accessPlan(plan) === 'paid';
}

/** Sharing a recording by link is paid (sharing design, decision 2). The server checks it again. */
export function canShare(plan: Plan): boolean {
  return accessPlan(plan) === 'paid';
}
