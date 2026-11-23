import { createFocusProgress } from '../focusProgress';

describe('Jogadores progress (Android sends it; iOS sends nothing, so no percent there)', () => {
  it('has no percent before the native analysis says anything', () => {
    const p = createFocusProgress();
    expect(p.percent('/a.mp4')).toBeUndefined();
  });

  it('gives the share of the frames done, per clip file', () => {
    const p = createFocusProgress();
    p.onNative({ clipPath: '/a.mp4', done: 15, total: 75 });
    expect(p.percent('/a.mp4')).toBe(20);
    expect(p.percent('/b.mp4')).toBeUndefined();
  });

  it('shows no percent while nothing is done yet (the spinner, as Bola)', () => {
    const p = createFocusProgress();
    p.onNative({ clipPath: '/a.mp4', done: 0, total: 75 });
    expect(p.percent('/a.mp4')).toBeUndefined();
    p.onNative({ clipPath: '/a.mp4', done: 3, total: 0 });
    expect(p.percent('/a.mp4')).toBeUndefined();
  });

  it('never goes over 100', () => {
    const p = createFocusProgress();
    p.onNative({ clipPath: '/a.mp4', done: 80, total: 75 });
    expect(p.percent('/a.mp4')).toBe(100);
  });

  it('forgets a clip when its analysis ends, so a new analysis starts from the spinner', () => {
    const p = createFocusProgress();
    p.onNative({ clipPath: '/a.mp4', done: 40, total: 75 });
    p.clear('/a.mp4');
    expect(p.percent('/a.mp4')).toBeUndefined();
  });

  it('tells its listeners when a percent changes, and stops after the unsubscribe', () => {
    const p = createFocusProgress();
    const heard = jest.fn();
    const stop = p.subscribe(heard);
    p.onNative({ clipPath: '/a.mp4', done: 1, total: 75 });
    p.clear('/a.mp4');
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    p.onNative({ clipPath: '/a.mp4', done: 2, total: 75 });
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('does not wake the listeners for a frame that leaves the percent as it was', () => {
    const p = createFocusProgress();
    const heard = jest.fn();
    p.subscribe(heard);
    p.onNative({ clipPath: '/a.mp4', done: 100, total: 1000 });
    p.onNative({ clipPath: '/a.mp4', done: 101, total: 1000 });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
