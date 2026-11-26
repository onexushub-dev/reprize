import { initialWindowMetrics } from 'react-native-safe-area-context';

/**
 * The phone's safe area, read once (the app is portrait only). SafeAreaView measures itself after it appears: on every
 * clip a swipe brought in, the bars jumped by the home bar's height (2026-11-21), and the edit mode, opened while the
 * clip screen still moved, could keep no margin at all, its bars under the status bar and the home bar (2026-11-22).
 */
export const INSETS = initialWindowMetrics ? initialWindowMetrics.insets : { top: 0, bottom: 0, left: 0, right: 0 };
