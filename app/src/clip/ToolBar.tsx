import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import type { ToolId } from './editSession';
import { EDIT_TOOLS, type EditTool } from './tools';

/** The edit mode's tools side by side (scrolls when there are more than fit); the open one is amber. */
export function ToolBar({
  open,
  focusOn,
  onOpen,
  tools = EDIT_TOOLS,
}: {
  open: ToolId;
  focusOn: boolean;
  onOpen: (id: ToolId) => void;
  /** The tools this phone has (no Foco where Modo Foco cannot run). */
  tools?: EditTool[];
}) {
  const { t } = useT();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>
      {tools.map((tool) => {
        const selected = tool.id === open;
        const marked = tool.id === 'focus' && focusOn;
        return (
          <Pressable
            key={tool.id}
            accessibilityRole="tab"
            accessibilityLabel={marked ? t('clip.toolOn', { tool: t(tool.label) }) : t(tool.label)}
            accessibilityState={{ selected }}
            onPress={() => onOpen(tool.id)}
            style={styles.tool}>
            <View style={[styles.icon, selected ? styles.iconOn : null]}>
              {tool.icon(selected ? colors.onAccent : marked ? colors.accent : colors.text)}
            </View>
            <Text style={[styles.label, selected ? styles.labelOn : null]}>{t(tool.label)}</Text>
            {marked && !selected ? <View style={styles.dot} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Few tools for the width: spread evenly over the bar; more than fit: scroll, as before.
  bar: { flexGrow: 1, justifyContent: 'space-evenly', paddingHorizontal: 6, gap: 2 },
  tool: { width: 66, alignItems: 'center', gap: 6, paddingTop: 6 },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: { backgroundColor: colors.accent },
  label: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.soft },
  labelOn: { color: colors.accent },
  dot: { position: 'absolute', top: 4, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
});
