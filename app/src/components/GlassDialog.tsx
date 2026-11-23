import { useEffect, useSyncExternalStore } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts } from '../theme/tokens';
import { closeDialog, currentDialog, subscribeDialog } from './dialog';
import { GLASS } from './GlassButton';

/**
 * Shows the dialog asked for with `showDialog` (2026-11-23): a glass card over a dimmed screen, the title and body
 * centred, Cancelar (quiet) and the action (amber) side by side. Mounted once, in the root layout, over the screens.
 * Drawn in the app's own view, not a native Modal: an action that opens a sheet (the share screen) would otherwise
 * be presented while the Modal is still closing, which iOS can refuse (review 2026-11-23).
 */
export function GlassDialogHost() {
  const spec = useSyncExternalStore(subscribeDialog, currentDialog, currentDialog);
  // Android's back button closes it, as Cancelar.
  useEffect(() => {
    if (spec === undefined) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeDialog();
      return true;
    });
    return () => sub.remove();
  }, [spec]);
  if (spec === undefined) return null;
  const confirm = () => {
    closeDialog();
    spec.onConfirm();
  };
  return (
    <View style={styles.backdrop} testID="glass-dialog">
      <View accessibilityViewIsModal style={styles.card}>
        <View style={styles.texts}>
          <Text accessibilityRole="header" style={styles.title}>
            {spec.title}
          </Text>
          {spec.body !== undefined ? <Text style={styles.body}>{spec.body}</Text> : null}
        </View>
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={spec.cancel}
            onPress={closeDialog}
            style={[styles.button, styles.quiet]}>
            <Text style={styles.quietText}>{spec.cancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={spec.confirm}
            onPress={confirm}
            style={[styles.button, styles.action]}>
            <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {spec.confirm}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  card: {
    width: 284,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(38,38,38,0.96)',
    borderWidth: 1,
    borderColor: GLASS.rim,
    borderTopColor: GLASS.rimTop,
  },
  texts: { paddingTop: 22, paddingHorizontal: 18, paddingBottom: 18, gap: 6 },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.soft,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quiet: { backgroundColor: 'rgba(255,255,255,0.10)' },
  quietText: { fontFamily: fonts.bodySemi, fontSize: 15.5, color: colors.text },
  action: { backgroundColor: colors.accent },
  actionText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15.5,
    color: colors.onAccent,
  },
});
