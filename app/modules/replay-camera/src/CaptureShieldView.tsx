import { requireNativeView } from 'expo';
import * as React from 'react';
import { Platform, View } from 'react-native';

import { CaptureShieldViewProps } from './ReplayCamera.types';

/** Only the iOS module has this view. */
const NativeView: React.ComponentType<CaptureShieldViewProps> | null =
  Platform.OS === 'ios' ? requireNativeView('ReplayCamera', 'CaptureShieldView') : null;

/**
 * Keeps its children out of screenshots and screen recordings (iOS; spike 3 of the sharing design). Elsewhere it is a
 * plain view and nothing is protected.
 */
export default function CaptureShieldView(props: CaptureShieldViewProps) {
  if (NativeView === null) return <View style={props.style}>{props.children}</View>;
  return <NativeView {...props} />;
}
