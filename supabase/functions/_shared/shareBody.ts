// The body of a create-share request, checked, and the order of its uploads
// (docs/superpowers/specs/2026-11-16-recording-sharing-design.md §5.4.1; groups:
// docs/superpowers/specs/2026-11-22-multi-recording-share-design.md §4.2). Pure: no network, no Deno APIs, so it is
// tested on its own (shareBody_test.ts).

export const MAX_CLIPS = 200;
export const MAX_CLIP_BYTES = 1536 * 1024 * 1024;
export const MAX_EDIT_CHARS = 4096;
/** Recordings in one group link (decision 3) and the clips of all of them together. */
export const MAX_GROUP_RECORDINGS = 10;
export const MAX_GROUP_CLIPS = 600;

export type ClipIn = {
  position: number;
  bytes: number;
  durationMs: number;
  checksum: string | null;
  edit: Record<string, unknown>;
  hasThumb: boolean;
  hasFocus: boolean;
  hasBall: boolean;
};

export type ShareIn = {
  kind: 'recording' | 'clip';
  title: string | null;
  sport: string | null;
  /** How long the recording ran (ms); null when not sent. */
  recordedMs: number | null;
  cover: boolean;
  clips: ClipIn[];
};

export type GroupIn = { kind: 'group'; recordings: ShareIn[] };

export type PlannedUpload = { key: string; kind: string; position: number | null; contentType: string };

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length <= max ? text : undefined;
}

/** A recording or single-clip body, checked; null when something is off. */
export function parseShare(body: Record<string, unknown>): ShareIn | null {
  const kind = body.kind;
  if (kind !== 'recording' && kind !== 'clip') return null;
  const title = optionalText(body.title, 80);
  const sport = optionalText(body.sport, 30);
  if (title === undefined || sport === undefined) return null;
  const recordedMs = body.recordedMs === undefined || body.recordedMs === null ? null : body.recordedMs;
  if (recordedMs !== null && !isInt(recordedMs, 0, 24 * 60 * 60 * 1000)) return null;
  if (!Array.isArray(body.clips) || body.clips.length < 1 || body.clips.length > MAX_CLIPS) return null;
  if (kind === 'clip' && body.clips.length !== 1) return null;
  const clips: ClipIn[] = [];
  const seen = new Set<number>();
  for (const raw of body.clips) {
    if (typeof raw !== 'object' || raw === null) return null;
    const c = raw as Record<string, unknown>;
    if (!isInt(c.position, 1, 999) || seen.has(c.position)) return null;
    seen.add(c.position);
    if (!isInt(c.bytes, 1, MAX_CLIP_BYTES) || !isInt(c.durationMs, 1, 10 * 60 * 1000)) return null;
    const checksum = optionalText(c.checksum, 128);
    if (checksum === undefined) return null;
    const edit = c.edit === undefined || c.edit === null ? {} : c.edit;
    if (typeof edit !== 'object' || Array.isArray(edit) || JSON.stringify(edit).length > MAX_EDIT_CHARS) return null;
    clips.push({
      position: c.position,
      bytes: c.bytes,
      durationMs: c.durationMs,
      checksum,
      edit: edit as Record<string, unknown>,
      hasThumb: c.hasThumb === true,
      hasFocus: c.hasFocus === true,
      hasBall: c.hasBall === true,
    });
  }
  clips.sort((a, b) => a.position - b.position);
  return { kind, title, sport, recordedMs: recordedMs as number | null, cover: body.cover !== false, clips };
}

/**
 * A group body, `{ kind: 'group', recordings: [...] }`: 2 to 10 recordings, each checked as a recording body (its
 * kind is 'recording' whatever was sent, and it has no cover of its own: the group's is the first recording's first
 * clip), at most 600 clips together. Null when something is off.
 */
export function parseGroup(body: Record<string, unknown>): GroupIn | null {
  if (body.kind !== 'group' || !Array.isArray(body.recordings)) return null;
  const count = body.recordings.length;
  if (count < 2 || count > MAX_GROUP_RECORDINGS) return null;
  const recordings: ShareIn[] = [];
  let clips = 0;
  for (const raw of body.recordings) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const recording = parseShare({ ...(raw as Record<string, unknown>), kind: 'recording' });
    if (recording === null) return null;
    clips += recording.clips.length;
    recordings.push({ ...recording, cover: false });
  }
  if (clips > MAX_GROUP_CLIPS) return null;
  return { kind: 'group', recordings };
}

/**
 * The uploads of one share, in queue order (§5.4): thumbnails, the cover, then each clip's video with its framing
 * files. Keys under `shares/<share id>/`.
 */
export function plannedUploads(shareId: string, share: Pick<ShareIn, 'cover' | 'clips'>): PlannedUpload[] {
  const prefix = `shares/${shareId}`;
  const plan: PlannedUpload[] = [];
  for (const c of share.clips) {
    if (c.hasThumb) plan.push({ key: `${prefix}/clips/${c.position}/thumb.jpg`, kind: 'thumb', position: c.position, contentType: 'image/jpeg' });
  }
  if (share.cover) plan.push(...coverUploads(shareId));
  for (const c of share.clips) {
    plan.push({ key: `${prefix}/clips/${c.position}/video.mp4`, kind: 'video', position: c.position, contentType: 'video/mp4' });
    if (c.hasFocus) plan.push({ key: `${prefix}/clips/${c.position}/focus.json`, kind: 'focus', position: c.position, contentType: 'application/json' });
    if (c.hasBall) plan.push({ key: `${prefix}/clips/${c.position}/ball.json`, kind: 'ball', position: c.position, contentType: 'application/json' });
  }
  return plan;
}

/** The web cover (still and video) of a share or a group. */
export function coverUploads(shareId: string): PlannedUpload[] {
  return [
    { key: `shares/${shareId}/cover.jpg`, kind: 'coverImage', position: null, contentType: 'image/jpeg' },
    { key: `shares/${shareId}/cover.mp4`, kind: 'cover', position: null, contentType: 'video/mp4' },
  ];
}

/** The group's rows for `create_share_group` (camelCase keys, as the SQL function reads them). */
export function groupRows(group: GroupIn): Record<string, unknown>[] {
  return group.recordings.map((r) => ({
    title: r.title,
    sport: r.sport,
    recordedMs: r.recordedMs,
    clips: r.clips.map((c) => ({
      position: c.position,
      bytes: c.bytes,
      durationMs: c.durationMs,
      checksum: c.checksum,
      edit: c.edit,
      hasThumb: c.hasThumb,
      hasFocus: c.hasFocus,
      hasBall: c.hasBall,
    })),
  }));
}
