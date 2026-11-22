import { useLayoutEffect, useRef, useState } from 'react';
import { PanResponder } from 'react-native';

import { NO_ZOOM, panZoom, pinchZoom, type Zoom } from './editing';

type Touch = { pageX: number; pageY: number };
type Props = {
  zoom: Zoom;
  /** False (watch mode): fingers never zoom or move the picture; tap, swipe and hold still work. Default true. */
  pinch?: boolean;
  /** Where a gesture starts from when the picture is not showing `zoom` (Modo Foco's moving framing). */
  baseZoom?: () => Zoom;
  /** Where the video sits inside the touch area, to turn finger movement into a fraction of it. */
  box: { left: number; top: number; width: number; height: number };
  onChange: (zoom: Zoom) => void;
  onCommit: (zoom: Zoom) => void;
  onTap: () => void;
  onSwipe?: (step: 1 | -1) => void;
  /** A one-finger sideways drag that may become a swipe, as it happens: how far it went (Photos-like paging). */
  onDrag?: (dx: number) => void;
  /** The drag let go without changing the clip: put the picture back. */
  onDragCancel?: () => void;
  /**
   * A one-finger drag that starts downward, as it happens (2026-11-21, like Photos): the picture follows the finger on
   * both axes; `onDownEnd` says whether it went far or fast enough to close the clip.
   */
  onDown?: (dx: number, dy: number) => void;
  onDownEnd?: (close: boolean) => void;
  /** A still finger held past HOLD_MS: true when it starts, false when the finger lifts (no tap, no commit then). */
  onHold?: (down: boolean) => void;
};

const TAP_SLOP = 10;
const TAP_MS = 350;
/**
 * Changing clips (2026-11-21: it sometimes took a long or fast swipe). A drag past this share of the picture's width
 * (or SWIPE_MIN points) changes the clip, like Photos; a flick needs only FLICK_MIN points at FLICK_VX; and the drag
 * only has to lean sideways (more sideways than up or down by SIDEWAYS), not be almost flat.
 */
const SWIPE_MIN = 50;
const SWIPE_SHARE = 0.18;
const FLICK_VX = 0.3;
const FLICK_MIN = 16;
const SIDEWAYS = 1.2;
/** A drag down this far, or flicked down this fast, closes the clip (like Photos). */
const CLOSE_DY = 110;
const CLOSE_VY = 0.5;
/** Longer than a tap, so a slow tap never turns into a hold. */
const HOLD_MS = 400;

/** Two fingers pinch and move the picture, one finger moves it when zoomed in; a short touch without movement is a tap. */
export function useZoomGesture(props: Props) {
  // Pan callbacks read the latest props through this ref (updated after each commit).
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  // eslint-disable-next-line react-hooks/refs -- the ref is only read inside pan callbacks, never during render
  const [responder] = useState(() => {
    let origin = { x: 0, y: 0 };
    let current: Zoom = NO_ZOOM;
    let previous: { count: number; x: number; y: number; distance: number } | undefined;
    let startedAt = 0;
    let travelled = 0;
    let multi = false;
    let totalX = 0;
    let totalY = 0;
    // Over a followed picture (Modo Foco) one finger only flicks between clips; two fingers take over the framing.
    let following = false;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let holding = false;
    let dragged = false;
    // Which way a one-finger drag goes, once it has moved past the tap's slop: down (close) or sideways (paging).
    let axis: 'down' | 'side' | undefined;
    const stopHoldTimer = () => {
      if (holdTimer !== undefined) clearTimeout(holdTimer);
      holdTimer = undefined;
    };
    /** Ends a hold; true when there was one (the touch then means nothing else). */
    const endHold = () => {
      stopHoldTimer();
      if (!holding) return false;
      holding = false;
      const onHold = latest.current.onHold;
      if (onHold) onHold(false);
      return true;
    };

    const read = (touches: readonly Touch[]) => {
      const x = touches.reduce((sum, t) => sum + t.pageX, 0) / touches.length;
      const y = touches.reduce((sum, t) => sum + t.pageY, 0) / touches.length;
      const distance =
        touches.length > 1 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;
      return { count: touches.length, x, y, distance };
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        following = latest.current.baseZoom !== undefined;
        dragged = false;
        current = latest.current.baseZoom ? latest.current.baseZoom() : latest.current.zoom;
        previous = read(e.nativeEvent.touches);
        startedAt = Date.now();
        travelled = 0;
        totalX = 0;
        totalY = 0;
        multi = previous.count > 1;
        // Where the touch area starts on screen: the touch's page position minus its position inside the area.
        const first = e.nativeEvent.touches[0] as Touch & { locationX?: number; locationY?: number };
        origin = { x: first.pageX - (first.locationX ?? 0), y: first.pageY - (first.locationY ?? 0) };
        stopHoldTimer();
        holding = false;
        axis = undefined;
        if (latest.current.onHold) {
          holdTimer = setTimeout(() => {
            holdTimer = undefined;
            const onHold = latest.current.onHold;
            if (multi || travelled >= TAP_SLOP || !onHold) return;
            holding = true;
            onHold(true);
          }, HOLD_MS);
        }
      },
      onPanResponderMove: (e) => {
        if (holding) return; // the picture is shown whole until the finger lifts
        const touches = e.nativeEvent.touches;
        if (!touches.length) return;
        const next = read(touches);
        multi ||= next.count > 1;
        const { box } = latest.current;
        const { width, height } = box;
        // Only moves between two readings with the same number of fingers count: a finger landing or leaving jumps the centre.
        if (previous && previous.count === next.count && width > 0 && height > 0) {
          const dx = next.x - previous.x;
          const dy = next.y - previous.y;
          travelled += Math.hypot(dx, dy);
          totalX += dx;
          totalY += dy;
          if (axis === undefined && !multi && travelled >= TAP_SLOP) {
            const downward = latest.current.onDown !== undefined && totalY > 0 && totalY > Math.abs(totalX);
            axis = downward && (following || latest.current.pinch === false) ? 'down' : 'side';
            // The first few points already moved the picture sideways: put it back, the drag is a close.
            const onDragCancel = latest.current.onDragCancel;
            if (axis === 'down' && dragged && onDragCancel) {
              dragged = false;
              onDragCancel();
            }
          }
          if (axis === 'down') {
            stopHoldTimer();
            const onDown = latest.current.onDown;
            if (onDown) onDown(totalX, totalY);
            previous = next;
            return;
          }
          const onDrag = latest.current.onDrag;
          if (onDrag && !multi && (following || latest.current.pinch === false)) {
            dragged = true;
            onDrag(totalX);
          }
          if ((following && !multi) || latest.current.pinch === false) {
            previous = next;
            return;
          }
          let zoom = current;
          if (next.count > 1 && previous.distance > 0) {
            const focal = { x: (next.x - origin.x - box.left) / width, y: (next.y - origin.y - box.top) / height };
            zoom = pinchZoom(zoom, next.distance / previous.distance, {
              x: Math.min(Math.max(focal.x, 0), 1),
              y: Math.min(Math.max(focal.y, 0), 1),
            });
          }
          current = panZoom(zoom, dx / width, dy / height);
          latest.current.onChange(current);
        }
        previous = next;
      },
      onPanResponderRelease: (_, g) => {
        if (endHold()) return;
        if (axis === 'down') {
          const onDownEnd = latest.current.onDownEnd;
          if (onDownEnd) onDownEnd(totalY > CLOSE_DY || g.vy > CLOSE_VY);
          return;
        }
        const tap = !multi && travelled < TAP_SLOP && Date.now() - startedAt < TAP_MS;
        const width = latest.current.box.width;
        const far = Math.abs(totalX) > Math.max(SWIPE_MIN, width * SWIPE_SHARE);
        // A flick in the drag's own direction (a finger pulled back at the end means "stay").
        const flick = Math.abs(g.vx) > FLICK_VX && Math.abs(totalX) > FLICK_MIN && Math.sign(g.vx) === Math.sign(totalX);
        const backwards = Math.abs(g.vx) > FLICK_VX && Math.sign(g.vx) !== Math.sign(totalX);
        const swipe =
          !multi &&
          (following || latest.current.pinch === false || latest.current.zoom.scale <= 1.01) &&
          ((far && !backwards) || flick) &&
          Math.abs(totalX) > SIDEWAYS * Math.abs(totalY);
        if (swipe && latest.current.onSwipe) return latest.current.onSwipe(totalX < 0 ? 1 : -1);
        const onDragCancel = latest.current.onDragCancel;
        if (dragged && onDragCancel) onDragCancel();
        if (tap) latest.current.onTap();
        else if (latest.current.pinch !== false) latest.current.onCommit(current);
      },
      onPanResponderTerminate: () => {
        if (endHold()) return;
        if (axis === 'down') {
          const onDownEnd = latest.current.onDownEnd;
          if (onDownEnd) onDownEnd(false);
          return;
        }
        const onDragCancel = latest.current.onDragCancel;
        if (dragged && onDragCancel) onDragCancel();
        if (latest.current.pinch !== false) latest.current.onCommit(current);
      },
    });
  });

  return responder.panHandlers;
}
