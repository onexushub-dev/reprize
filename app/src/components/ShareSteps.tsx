import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { CheckIcon } from './icons';

const STEPS = ['sharing.stepSignIn', 'sharing.stepNotice', 'sharing.stepLink'] as const;

/** Where the first share is: Entrar → Aviso → Link, the current step and the ones before it in amber. */
export function ShareSteps({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useT();
  return (
    <View style={styles.root} accessible accessibilityLabel={t('sharing.stepA11y', { step })}>
      {STEPS.map((key, i) => {
        const n = i + 1;
        const on = n <= step;
        return (
          <Fragment key={key}>
            <View style={styles.step}>
              <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]}>
                {n < step ? <CheckIcon size={13} /> : <Text style={[styles.number, on && styles.numberOn]}>{n}</Text>}
              </View>
              <Text style={[styles.label, on && styles.labelOn]}>{t(key)}</Text>
            </View>
            {n < STEPS.length ? <View style={styles.line} /> : null}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotOn: { backgroundColor: colors.accent },
  dotOff: { borderWidth: 1, borderColor: colors.border },
  number: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.muted },
  numberOn: { color: colors.onAccent },
  label: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  labelOn: { color: colors.text },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
});
