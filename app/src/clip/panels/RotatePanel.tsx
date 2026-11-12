import { View } from 'react-native';

import { useT } from '../../i18n/useT';
import type { ToolContext } from '../tools';
import { Choice, PanelHead } from './PanelParts';

export function RotatePanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  return (
    <View style={{ gap: 10 }}>
      <PanelHead title={t('clip.toolRotate')} />
      <View style={{ flexDirection: 'row' }}>
        <Choice label={t('clip.rotate90')} a11y={t('clip.rotate')} onPress={ctx.turn} />
      </View>
    </View>
  );
}
