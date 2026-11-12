import { View } from 'react-native';

import { SPEEDS } from '../../share/editing';
import { useT } from '../../i18n/useT';
import type { ToolContext } from '../tools';
import { Choice, PanelHead, panelStyles } from './PanelParts';

export function SpeedPanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  return (
    <View style={{ gap: 10 }}>
      <PanelHead title={t('clip.toolSpeed')} />
      <View style={panelStyles.row}>
        {SPEEDS.map((speed) => (
          <Choice
            key={speed}
            label={`${speed}x`}
            a11y={t('clip.speed', { speed })}
            selected={ctx.edit.speed === speed}
            onPress={() => ctx.setEdit({ speed })}
          />
        ))}
      </View>
    </View>
  );
}
