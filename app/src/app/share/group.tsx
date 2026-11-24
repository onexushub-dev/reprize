import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { SHARING_ENABLED } from '../../account/flags';
import { groupLive, linkOrder, liveGroupFor, shareRecordings, turnOffGroupShare } from '../../cloud/shareGroup';
import { groupClips, shareGroup, type ShareGroup } from '../../cloud/shareGroups';
import { GroupUploadStatus } from '../../components/GroupUploadStatus';
import { ShareFlow } from '../../components/ShareFlow';
import { ShareLinkPanel } from '../../components/ShareLinkPanel';
import { useT } from '../../i18n/useT';

/**
 * Compartilhar gravações (multi-recording share design §6): one link for 2 to 10 recordings, with the same steps as one
 * recording's sheet. Opened from Minhas gravações with the picked recordings (`ids`, comma separated) or from a
 * recording's strip with the link (`group`).
 */
export default function ShareGroupScreen() {
  const params = useLocalSearchParams<{ ids?: string; group?: string }>();
  // The recordings are fixed when the sheet opens: the link it shows is about them.
  const [sessionIds] = useState(() => {
    if (typeof params.group === 'string') {
      const known = shareGroup(params.group);
      if (known !== undefined) return known.recordings.map((r) => r.sessionId);
    }
    return typeof params.ids === 'string' ? linkOrder(params.ids.split(',').filter((id) => id !== '')) : [];
  });
  if (!SHARING_ENABLED || sessionIds.length < 2) return <Redirect href="/" />;
  return <ShareGroupFlow sessionIds={sessionIds} groupId={typeof params.group === 'string' ? params.group : undefined} />;
}

function ShareGroupFlow({ sessionIds, groupId }: { sessionIds: string[]; groupId: string | undefined }) {
  const { t } = useT();
  return (
    <ShareFlow<ShareGroup>
      target={{
        title: t('sharing.groupTitle'),
        initial: () => {
          // From a strip, the link as long as it is on; from the list, the live link of exactly these recordings.
          const known = groupId === undefined ? undefined : shareGroup(groupId);
          if (known !== undefined && groupLive(known)) return known;
          return liveGroupFor(sessionIds);
        },
        create: async () => {
          const result = await shareRecordings(sessionIds);
          return result.ok ? { ok: true, value: result.group } : result;
        },
        turnOff: (group) => turnOffGroupShare(group.groupId),
        keyOf: (group) => group.groupId,
        coverSessionId: (group) => group.recordings[0].sessionId,
        renderReady: (group) => (
          <ShareLinkPanel
            shared={{ shareId: group.groupId, url: group.url, expiresAt: group.expiresAt, clips: groupClips(group) }}
            recordings={group.recordings.length}
            upload={<GroupUploadStatus group={group} />}
          />
        ),
      }}
    />
  );
}
