import { Text, View } from 'react-native';

import { useT } from '../../i18n/useT';
import type { ToolContext } from '../tools';
import { Choice, PanelHead, panelStyles } from './PanelParts';

export function SoundPanel({ ctx }: { ctx: ToolContext }) {
  const { t } = useT();
  const locked = ctx.edit.speed !== 1;
  const on = !ctx.edit.muted && !locked;
  return (
    <View style={{ gap: 10 }}>
      {/* On a free recording the sound plays here but does not leave the app: the Pro pill says so (the save sheet
          lists it again). */}
      <PanelHead title={t('clip.sound')} pro={ctx.plan === 'free' ? t('setup.proBadge') : undefined} />
      <View style={panelStyles.row}>
        <Choice
          label={on ? t('clip.soundOn') : t('clip.muted')}
          a11y={t('clip.sound')}
          selected={on}
          disabled={locked}
          onPress={locked ? undefined : () => ctx.setEdit({ muted: !ctx.edit.muted })}
        />
      </View>
      {locked ? <Text style={panelStyles.note}>{t('clip.soundLocked')}</Text> : null}
    </View>
  );
}
