import { Redirect, useLocalSearchParams } from 'expo-router';

import { SHARING_ENABLED } from '../../account/flags';
import { liveGroupOf } from '../../cloud/shareGroup';
import { liveShare, shareRecording, turnOffRecordingShare } from '../../cloud/shareRecording';
import { ShareFlow } from '../../components/ShareFlow';
import { ShareLinkPanel } from '../../components/ShareLinkPanel';
import type { SessionShare } from '../../data/schema';
import { useT } from '../../i18n/useT';

/**
 * Compartilhar gravação (sharing design §3.1): sign in if needed, the liability notice the first time, then the link and
 * its QR code. A link that is still live opens straight away. Reached from an ended recording, PRO only. A recording in
 * a live group link opens that link's sheet: it is already shared there.
 */
export default function ShareScreen() {
  const { id, clips } = useLocalSearchParams<{ id: string; clips?: string }>();
  if (!SHARING_ENABLED) return <Redirect href="/" />;
  const group = liveGroupOf(id);
  if (group !== undefined) return <Redirect href={`/share/group?group=${group.groupId}`} />;
  // Picked clips (2026-11-23): `clips` lists their ids; without it the whole recording goes.
  const clipIds = typeof clips === 'string' && clips !== '' ? clips.split(',') : undefined;
  return <ShareRecording sessionId={id} clipIds={clipIds} />;
}

function ShareRecording({ sessionId, clipIds }: { sessionId: string; clipIds?: string[] }) {
  const { t } = useT();
  return (
    <ShareFlow<SessionShare>
      target={{
        title: t('sharing.title'),
        initial: () => liveShare(sessionId),
        create: async () => {
          const result = await shareRecording(sessionId, undefined, clipIds);
          return result.ok ? { ok: true, value: result.shared } : result;
        },
        turnOff: () => turnOffRecordingShare(sessionId),
        keyOf: (shared) => shared.shareId,
        coverSessionId: () => sessionId,
        renderReady: (shared) => <ShareLinkPanel shared={shared} />,
      }}
    />
  );
}
