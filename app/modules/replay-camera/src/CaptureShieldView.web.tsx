import * as React from 'react';
import { View } from 'react-native';

import { CaptureShieldViewProps } from './ReplayCamera.types';

// Nothing is protected on the web: a plain view.
export default function CaptureShieldView(props: CaptureShieldViewProps) {
  return <View style={props.style}>{props.children}</View>;
}
