import { Alert, Platform } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import Setup from "../setup";
import { clearRemotePress, setRemoteSheetOpen } from "../../devices/remoteTest";

jest.mock("../../../modules/replay-camera", () => {
  const { useEffect } = jest.requireActual("react");
  const mounts = { count: 0, style: undefined as unknown };
  return {
    __mounts: mounts,
    requestSpeechPermission: jest.fn(async () => true),
    isVoiceSupported: jest.fn(() => true),
    getSpeechPermission: jest.fn(() => "granted"),
    getWatchStatus: jest.fn(() => "unsupported"),
    getZoomRange: jest.fn(() => ({ min: 0.5, max: 5, continuous: true })),
    getDeviceUpright: jest.fn(() => "portrait"),
    getDeviceGravity: jest.fn(() => null),
    isRemoteSupported: jest.fn(() => false),
    isRemoteControllerSupported: jest.fn(() => false),
    supportsQuality: jest.fn(() => true),
    setScreenEconomy: jest.fn(),
    setCameraIdle: jest.fn(),
    remoteControllerHost: jest.fn(() => null),
    remoteControllerForget: jest.fn(),
    remoteHostStart: jest.fn(),
    remoteHostStop: jest.fn(),
    remoteHostControllers: jest.fn(() => 0),
    remoteHostPeers: jest.fn(() => []),
    addReplayListener: jest.fn(() => ({ remove: jest.fn() })),
    setGestureEnabled: jest.fn(),
    setVoiceEnabled: jest.fn(),
    signalSaved: jest.fn(),
    signalAction: jest.fn(),
    signalSaveFailed: jest.fn(),
    ReplayCameraView: (props: { style?: unknown }) => {
      mounts.style = props.style;
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return null;
    },
  };
});
jest.mock("../../triggers/useVolumeRemote", () => ({
  useVolumeRemote: jest.fn(),
}));
jest.mock("expo-router", () => ({
  router: {
    replace: jest.fn(),
    back: jest.fn(),
    push: jest.fn(),
    navigate: jest.fn(),
  },
  useIsFocused: jest.fn(() => true),
}));
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: jest.fn(async () => {}),
  deactivateKeepAwake: jest.fn(),
}));
jest.mock("../../data/mmkv", () => {
  const initial = {
    onboardingDone: true,
    sport: "beachTennis",
    lens: "ultraWide",
    gestureEnabled: true,
    soundOnSave: true,
    flashOnSave: true,
    voiceEnabled: false,
    screenEconomy: true,
    prepareTipSeen: true, // the "Prepare o celular" sheet has its own tests
    cameraTourSeen: true, // the first-time tour has its own tests
  };
  let prefs: any = { ...initial };
  return {
    __reset: () => (prefs = { ...initial }),
    repo: {
      getPrefs: () => prefs,
      setPrefs: jest.fn((p: object) => (prefs = { ...prefs, ...p })),
      subscribe: jest.fn(() => () => {}),
      version: jest.fn(() => 0),
      getSession: jest.fn(() => undefined),
      allSessions: jest.fn(() => []),
    },
  };
});
jest.mock("../../analytics", () => ({
  track: jest.fn(),
  sessionSummary: { note: jest.fn() },
}));
jest.mock("../../session/SessionContext", () => ({ useSession: jest.fn() }));
jest.mock("../../share/entitlement", () => ({
  usePlan: jest.fn(() => "paid"),
}));
jest.mock("../../payments/feedback", () => ({
  openPaywall: jest.fn(async () => "cancelled"),
}));
jest.mock("../../payments", () => ({
  payments: {
    peekStart: jest.fn(() => ({ kind: "pro" })),
    credits: jest.fn(() => 0),
    freeLeft: jest.fn(() => 5),
    subscribe: jest.fn(() => () => {}),
    version: jest.fn(() => 0),
  },
}));

const { repo } = jest.requireMock("../../data/mmkv");
const { useSession } = jest.requireMock("../../session/SessionContext");
const { router } = jest.requireMock("expo-router");
const { payments } = jest.requireMock("../../payments");
const { openPaywall } = jest.requireMock("../../payments/feedback");

function session(state: object) {
  const value = {
    state: {
      phase: "idle",
      camera: "on",
      clipCount: 0,
      saving: false,
      paused: false,
      thermal: { level: "nominal", degraded: false },
      ...state,
    },
    start: jest.fn(async (): Promise<string | void> => {}),
    continueRecording: jest.fn(async (): Promise<string | void> => 'started'),
    prepare: jest.fn(async () => true),
    release: jest.fn(async () => {}),
    trigger: jest.fn(),
    setZoom: jest.fn(),
    reset: jest.fn(),
    undoLast: jest.fn(),
    stop: jest.fn(async () => "s1"),
  };
  useSession.mockReturnValue(value);
  return value;
}

/**
 * Upright (2026-11-22, after Lens Buddy): three buttons over the record button (clip length → quality → triggers), each
 * opening its panel over the camera.
 */
const clipButton = () => screen.getByRole("button", { name: /^Tamanho do clipe:/ });
const qualityButton = () => screen.getByRole("button", { name: /^Qualidade:/ });
const triggersButton = () => screen.getByRole("button", { name: /^Gatilhos:/ });
const openClip = () => fireEvent.press(clipButton());
const openQuality = () => fireEvent.press(qualityButton());
const openTriggers = () => fireEvent.press(triggersButton());
const recordButton = () => screen.getByRole("button", { name: "Gravar" });

beforeEach(() => {
  // A tap on the remote tile counts the sheet as opening for a moment: never carry it into the next test.
  setRemoteSheetOpen(false);
  jest.clearAllMocks();
  jest.requireMock("../../data/mmkv").__reset();
  clearRemotePress();
  const module = jest.requireMock("../../../modules/replay-camera");
  module.isRemoteSupported.mockReturnValue(false);
  module.isRemoteControllerSupported.mockReturnValue(false);
  module.getWatchStatus.mockReturnValue("unsupported");
  module.getZoomRange.mockReturnValue({ min: 0.5, max: 5, continuous: true });
  module.remoteHostPeers.mockReturnValue([]);
  module.getDeviceUpright.mockReturnValue("portrait");
  module.remoteControllerHost.mockReturnValue(null);
  jest.requireMock("../../share/entitlement").usePlan.mockReturnValue("paid");
  payments.peekStart.mockReturnValue({ kind: "pro" });
  payments.credits.mockReturnValue(0);
  openPaywall.mockResolvedValue("cancelled");
});

test("keeps the screen awake while the phone is being positioned", async () => {
  session({});
  await render(<Setup />);
  expect(
    jest.requireMock("expo-keep-awake").activateKeepAwakeAsync,
  ).toHaveBeenCalled();
});

test("under another screen (Minhas gravações, editor, Salvar) it releases the camera, the volume buttons and keep-awake", async () => {
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(false);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  const s = session({});
  await render(<Setup />);
  expect(s.prepare).not.toHaveBeenCalled();
  expect(s.release).toHaveBeenCalled();
  expect(useVolumeRemote).toHaveBeenLastCalledWith(
    false,
    expect.any(Function),
    expect.anything(),
  );
  expect(
    jest.requireMock("expo-keep-awake").activateKeepAwakeAsync,
  ).not.toHaveBeenCalled();
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(true);
});

test("turns the camera on for the live preview", async () => {
  const s = session({ camera: "off" });
  await render(<Setup />);
  expect(s.prepare).toHaveBeenCalledWith("quadra", "paid"); // a pre-modes sport opens as Quadra
});

const zoomButton = (name: string) => screen.getByRole("button", { name });

test("the zoom button shows only the current zoom, and the two lens buttons are gone", async () => {
  session({});
  await render(<Setup />);
  expect(zoomButton("Zoom 1x")).toBeTruthy(); // 1x by default, even with an ultra-wide
  expect(screen.queryByRole("button", { name: "1x" })).toBeNull();
  expect(screen.queryByRole("button", { name: "0.5x" })).toBeNull();
});

test("the zoom button shows the zoom saved for the mode", async () => {
  repo.setPrefs({ modeSettings: { quadra: { zoom: 2 } } });
  session({});
  await render(<Setup />);
  expect(zoomButton("Zoom 2x")).toBeTruthy();
});

test("a lens saved before zoom existed shows as its zoom", async () => {
  repo.setPrefs({ modeSettings: { quadra: { lens: "wide" } } });
  session({});
  await render(<Setup />);
  expect(zoomButton("Zoom 1x")).toBeTruthy();
});

test("each tap goes to the next zoom: 1 → 2 → 5 → 0.5 → 1, zooming the camera and saving it for the mode", async () => {
  const s = session({});
  await render(<Setup />);
  for (const [from, to] of [
    [1, 2],
    [2, 5],
    [5, 0.5],
    [0.5, 1],
  ] as const) {
    await fireEvent.press(zoomButton(`Zoom ${from}x`));
    expect(s.setZoom).toHaveBeenLastCalledWith(to, true);
    expect(repo.setPrefs).toHaveBeenLastCalledWith({
      modeSettings: { quadra: { zoom: to } },
    });
    expect(zoomButton(`Zoom ${to}x`)).toBeTruthy();
  }
});

test("each zoom tap counts once in the session summary and sends no event of its own", async () => {
  const { sessionSummary, track } = jest.requireMock("../../analytics");
  sessionSummary.note.mockClear();
  session({});
  await render(<Setup />);
  await fireEvent.press(zoomButton("Zoom 1x"));
  await fireEvent.press(zoomButton("Zoom 2x"));
  expect(sessionSummary.note.mock.calls).toEqual([["zoom"], ["zoom"]]);
  expect(track).not.toHaveBeenCalled();
});

test("changing the zoom does not ask the session to reopen the camera when it stays on the same lens", async () => {
  const s = session({});
  await render(<Setup />);
  s.prepare.mockClear();
  await fireEvent.press(zoomButton("Zoom 1x")); // → 2x: same lens (wide)
  await fireEvent.press(zoomButton("Zoom 2x")); // → 5x: same lens
  expect(s.prepare).not.toHaveBeenCalled();
});

test("with two fixed lenses (Android) the button only goes 0.5 ↔ 1 and there is no pinch", async () => {
  jest
    .requireMock("../../../modules/replay-camera")
    .getZoomRange.mockReturnValue({ min: 0.5, max: 1, continuous: false });
  const s = session({});
  await render(<Setup />);
  expect(screen.queryByTestId("zoom-pinch")).toBeNull();
  await fireEvent.press(zoomButton("Zoom 1x"));
  expect(s.setZoom).toHaveBeenLastCalledWith(0.5, true);
  await fireEvent.press(zoomButton("Zoom 0.5x"));
  expect(s.setZoom).toHaveBeenLastCalledWith(1, true);
});

test("an Android phone that hides its ultra-wide from apps has no zoom button", async () => {
  jest
    .requireMock("../../../modules/replay-camera")
    .getZoomRange.mockReturnValue({ min: 1, max: 1, continuous: false });
  repo.setPrefs({ modeSettings: { quadra: { zoom: 0.5 } } });
  session({});
  await render(<Setup />);
  expect(screen.queryByRole("button", { name: /^Zoom / })).toBeNull();
});

describe("pinch on the preview", () => {
  const two = (distance: number) => ({
    nativeEvent: {
      touches: [
        { pageX: 100, pageY: 300 },
        { pageX: 100 + distance, pageY: 300 },
      ],
    },
  });
  const one = { nativeEvent: { touches: [{ pageX: 100, pageY: 300 }] } };

  test("two fingers moving apart zoom in live and the zoom is saved when they lift", async () => {
    const s = session({});
    await render(<Setup />);
    const area = screen.getByTestId("zoom-pinch");
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(200)); // twice as far apart: 1x → 2x
    expect(s.setZoom).toHaveBeenLastCalledWith(2, false);
    expect(zoomButton("Zoom 2x")).toBeTruthy();
    expect(repo.setPrefs).not.toHaveBeenCalledWith({
      modeSettings: { quadra: { zoom: 2 } },
    }); // not saved mid-gesture
    await fireEvent(area, "responderMove", two(400)); // 4x as far apart: 4x
    expect(s.setZoom).toHaveBeenLastCalledWith(4, false);
    await fireEvent(area, "responderRelease", one);
    expect(repo.setPrefs).toHaveBeenLastCalledWith({
      modeSettings: { quadra: { zoom: 4 } },
    });
    expect(zoomButton("Zoom 4x")).toBeTruthy();
  });

  test("the pinch stays inside the camera range", async () => {
    const s = session({});
    await render(<Setup />);
    const area = screen.getByTestId("zoom-pinch");
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(5000));
    expect(s.setZoom).toHaveBeenLastCalledWith(5, false);
    await fireEvent(area, "responderMove", two(1));
    expect(s.setZoom).toHaveBeenLastCalledWith(0.5, false);
  });

  test("a pinch only takes over when two fingers are down", async () => {
    session({});
    await render(<Setup />);
    const area = screen.getByTestId("zoom-pinch");
    expect(area.props.onMoveShouldSetResponder(two(100))).toBe(true);
    expect(area.props.onMoveShouldSetResponder(one)).toBe(false);
    expect(area.props.onStartShouldSetResponder).toBeUndefined();
  });

  test("while pinching, the zoom button itself shows the value: no second bubble (2026-11-20)", async () => {
    session({});
    await render(<Setup />);
    const area = screen.getByTestId("zoom-pinch");
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(150));
    expect(zoomButton("Zoom 1.5x")).toBeTruthy();
    expect(screen.queryByTestId("zoom-bubble")).toBeNull();
  });

  test("the zoom button hides while a panel is open", async () => {
    session({});
    await render(<Setup />);
    expect(zoomButton("Zoom 1x")).toBeTruthy();
    await openTriggers();
    expect(screen.queryByRole("button", { name: "Zoom 1x" })).toBeNull();
  });

  test("the zoom button turns amber while pinching and a moment after, then goes back (2026-11-22)", async () => {
    jest.useFakeTimers();
    try {
      session({});
      await render(<Setup />);
      const lit = () => StyleSheet.flatten(screen.getByRole("button", { name: /^Zoom/ }).props.style).backgroundColor;
      const { StyleSheet } = jest.requireActual("react-native");
      const { colors } = jest.requireActual("../../theme/tokens");
      expect(lit()).not.toBe(colors.accent);
      const area = screen.getByTestId("zoom-pinch");
      await fireEvent(area, "responderGrant", two(100));
      await fireEvent(area, "responderMove", two(200));
      expect(lit()).toBe(colors.accent);
      await fireEvent(area, "responderRelease", one);
      expect(lit()).toBe(colors.accent);
      await act(async () => jest.advanceTimersByTime(1000));
      expect(lit()).not.toBe(colors.accent);
      // A tap on it too.
      await fireEvent.press(screen.getByRole("button", { name: /^Zoom/ }));
      expect(lit()).toBe(colors.accent);
      await act(async () => jest.advanceTimersByTime(1000));
      expect(lit()).not.toBe(colors.accent);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a second pinch starts from where the first one ended", async () => {
    const s = session({});
    await render(<Setup />);
    const area = screen.getByTestId("zoom-pinch");
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(200));
    await fireEvent(area, "responderRelease", one);
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(200)); // 2x → 4x
    expect(s.setZoom).toHaveBeenLastCalledWith(4, false);
  });
});

test("a quick camera reopen shows nothing (it only flashed); a slow one says so over the buttons (2026-11-22)", async () => {
  jest.useFakeTimers();
  try {
    session({ camera: "starting" });
    await render(<Setup />);
    // The buttons wait at once, but nothing changes on screen yet.
    expect(recordButton()).toBeDisabled();
    expect(screen.queryByText("Abrindo a câmera…")).toBeNull();
    expect(zoomButton("Zoom 1x")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(800));
    expect(screen.getByText("Abrindo a câmera…")).toBeTruthy();
    expect(clipButton()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Zoom 1x" })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("a panel opens above the settings by the same 16 pt the settings sit above the black (2026-11-22)", async () => {
  session({});
  await render(<Setup />);
  await openClip();
  const { StyleSheet } = jest.requireActual("react-native");
  // barHeight is 0 until the bar is laid out on a phone: the panel sits BAR_GAP above it.
  expect(StyleSheet.flatten(screen.getByTestId("clip-panel").props.style).bottom).toBe(16);
});

test('the Bluetooth remote and the Apple Watch come first, under "Recomendados", then the other triggers', async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByText("Recomendados")).toBeTruthy();
  expect(screen.getByText("Mais opções")).toBeTruthy();
  const recommended = screen.getByTestId("recommended-triggers");
  expect(within(recommended).getByRole("button", { name: /^Controle,/ })).toBeTruthy();
  expect(within(recommended).getByLabelText(/^Apple Watch,/)).toBeTruthy();
  expect(within(recommended).queryByRole("button", { name: /^Voz/ })).toBeNull();
});

test("on Android there is no Apple Watch trigger nor its icon in the triggers button; voice is offered", async () => {
  const os = Platform.OS;
  Platform.OS = "android";
  try {
    camera().getWatchStatus.mockReturnValue("ready");
    session({});
    await render(<Setup />);
    expect(triggersButton().props.accessibilityLabel).not.toMatch(/watch/i);
    await openTriggers();
    expect(screen.queryByLabelText(/^Apple Watch/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Voz/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Controle,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Aceno/ })).toBeTruthy();
  } finally {
    Platform.OS = os;
  }
});

test("opening the Bluetooth remote sheet keeps the camera on under it (it was stopped and reopened)", async () => {
  const value = session({});
  const view = await render(<Setup />);
  await openTriggers();
  await fireEvent.press(screen.getByRole("button", { name: /^Controle,/ }));
  expect(router.push).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: "/devices" }),
  );
  value.release.mockClear();
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(false); // the sheet covers the setup
  await view.rerender(<Setup />);
  expect(value.release).not.toHaveBeenCalled();
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(true);
});

test("the wave trigger toggles the gesture preference", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  await fireEvent.press(screen.getByRole("button", { name: /^Aceno/ }));
  expect(repo.setPrefs).toHaveBeenCalledWith(
    expect.objectContaining({
      modeSettings: expect.objectContaining({
        quadra: { gestureEnabled: false },
      }),
    }),
  );
});

describe("the first-time tour of the camera (2026-11-22)", () => {
  type FiberLike = { stateNode: unknown; return: FiberLike | null } | null;
  /**
   * Every host view answers where it is (the jest mock of measureInWindow answers nothing), then the screen renders
   * again so the bar measures its controls.
   */
  async function measured(view: { rerender: (ui: React.ReactElement) => Promise<void> }) {
    for (const el of screen.container.queryAll(() => true)) {
      let fiber = el.unstable_fiber as FiberLike;
      while (fiber !== null) {
        const node = fiber.stateNode as { measureInWindow?: unknown } | null;
        if (node !== null && typeof node === "object" && jest.isMockFunction(node.measureInWindow)) {
          (node.measureInWindow as jest.Mock).mockImplementation((cb: (x: number, y: number, w: number, h: number) => void) =>
            cb(20, 630, 80, 44),
          );
          break;
        }
        fiber = fiber.return;
      }
    }
    await act(async () => {
      await view.rerender(<Setup />);
    });
  }

  test("a new player gets four tips over the real controls, then never again", async () => {
    repo.setPrefs({ cameraTourSeen: undefined });
    session({});
    const view = await render(<Setup />);
    await measured(view);
    expect(screen.getByTestId("camera-tour")).toBeTruthy();
    expect(screen.getByText("1 de 4")).toBeTruthy();
    expect(screen.getByText("Defina o tamanho do clipe")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText("Qualidade da imagem")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText("Salve sem tocar no celular")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByText("4 de 4")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Entendi" }));
    expect(screen.queryByTestId("camera-tour")).toBeNull();
    expect(repo.getPrefs().cameraTourSeen).toBe(true);
  });

  test("Pular ends it for good", async () => {
    repo.setPrefs({ cameraTourSeen: undefined });
    session({});
    const view = await render(<Setup />);
    await measured(view);
    await fireEvent.press(screen.getByRole("button", { name: "Pular" }));
    expect(screen.queryByTestId("camera-tour")).toBeNull();
    expect(repo.getPrefs().cameraTourSeen).toBe(true);
  });

  test("seen before: no tour", async () => {
    session({});
    const view = await render(<Setup />);
    await measured(view);
    expect(screen.queryByTestId("camera-tour")).toBeNull();
  });
});

describe('"Prepare o celular" before a recording (2026-11-08)', () => {
  test('shown before the first start; "Entendi, começar" starts and hides it for good', async () => {
    repo.setPrefs({ prepareTipSeen: undefined });
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(recordButton());
    expect(s.start).not.toHaveBeenCalled();
    expect(screen.getByText("Sem capinha")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Entendi, começar" }),
    );
    expect(s.start).toHaveBeenCalledWith("quadra");
    expect(repo.getPrefs().prepareTipSeen).toBe(true);
  });

  test('with "Não mostrar de novo" off it comes back next time', async () => {
    repo.setPrefs({ prepareTipSeen: undefined });
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(recordButton());
    await fireEvent(
      screen.getByLabelText("Não mostrar de novo"),
      "valueChange",
      false,
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Entendi, começar" }),
    );
    expect(s.start).toHaveBeenCalled();
    expect(repo.getPrefs().prepareTipSeen).toBeUndefined();
  });

  test("a start from the remote never waits for it", async () => {
    repo.setPrefs({ prepareTipSeen: undefined });
    const s = session({});
    s.start.mockResolvedValue("started");
    await render(<Setup />);
    const { useVolumeRemote } = jest.requireMock(
      "../../triggers/useVolumeRemote",
    );
    await act(async () => useVolumeRemote.mock.calls.at(-1)[2].onHold());
    expect(s.start).toHaveBeenCalled();
  });
});

test("Gravar starts the one mode and shows the recording controls on the same screen", async () => {
  const s = session({});
  const view = await render(<Setup />);
  await fireEvent.press(recordButton());
  expect(s.start).toHaveBeenCalledWith("quadra");

  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await view.rerender(<Setup />);
  expect(screen.getByRole("button", { name: /Salvar os últimos/ })).toBeTruthy();
  expect(router.replace).not.toHaveBeenCalled();
});

test("the camera preview is shown at full brightness while recording", async () => {
  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await render(<Setup />);
  const { __mounts } = jest.requireMock("../../../modules/replay-camera");
  const { StyleSheet } = jest.requireActual("react-native");
  expect(StyleSheet.flatten(__mounts.style).opacity ?? 1).toBe(1);
});

test("one camera preview for the whole game: starting does not recreate it", async () => {
  const { __mounts } = jest.requireMock("../../../modules/replay-camera");
  __mounts.count = 0;
  session({});
  const view = await render(<Setup />);
  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await view.rerender(<Setup />);
  expect(__mounts.count).toBe(1);
});

test("a low-storage refusal shows its copy and the button works again", async () => {
  session({ phase: "idle", error: "LOW_STORAGE" });
  await render(<Setup />);
  expect(
    screen.getByText(
      "Pouco espaço no celular. Libere pelo menos 500 MB para gravar.",
    ),
  ).toBeTruthy();
  expect(recordButton()).toBeEnabled();
});

test("the button is disabled while the camera starts", async () => {
  session({ phase: "starting" });
  await render(<Setup />);
  expect(recordButton()).toBeDisabled();
});

test("save feedback toggles: sound and flash, in the triggers panel", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  await fireEvent.press(screen.getByRole("button", { name: "Som" }));
  expect(repo.setPrefs).toHaveBeenCalledWith({ soundOnSave: false });
  await fireEvent.press(screen.getByRole("button", { name: "Flash" }));
  expect(repo.setPrefs).toHaveBeenCalledWith({ flashOnSave: false });
});

test("turning voice on asks for speech permission first", async () => {
  const camera = jest.requireMock("../../../modules/replay-camera");
  camera.getSpeechPermission.mockReturnValueOnce("undetermined");
  session({});
  await render(<Setup />);
  await openTriggers();
  await fireEvent.press(screen.getByRole("button", { name: /^Voz/ }));
  expect(camera.requestSpeechPermission).toHaveBeenCalled();
  expect(jest.requireMock("../../analytics").track).toHaveBeenCalledWith(
    "permission_result",
    { kind: "speech", granted: true },
  );
  expect(repo.setPrefs).toHaveBeenCalledWith(
    expect.objectContaining({
      modeSettings: expect.objectContaining({
        quadra: expect.objectContaining({ voiceEnabled: true }),
      }),
    }),
  );
});

test("voice stays off when speech permission is denied", async () => {
  const camera = jest.requireMock("../../../modules/replay-camera");
  camera.getSpeechPermission.mockReturnValueOnce("undetermined");
  camera.requestSpeechPermission.mockResolvedValueOnce(false);
  repo.setPrefs({ voiceEnabled: false });
  jest.clearAllMocks();
  session({});
  await render(<Setup />);
  await openTriggers();
  await fireEvent.press(screen.getByRole("button", { name: /^Voz/ }));
  expect(repo.setPrefs).not.toHaveBeenCalled();
  expect(
    screen.getByText("Libere o reconhecimento de fala em Ajustes."),
  ).toBeTruthy();
  expect(jest.requireMock("../../analytics").track).toHaveBeenCalledWith(
    "permission_result",
    { kind: "speech", granted: false },
  );
});

test("the voice tile says when this phone cannot recognize speech offline", async () => {
  jest
    .requireMock("../../../modules/replay-camera")
    .isVoiceSupported.mockReturnValueOnce(false);
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByLabelText("Voz, Indisponível neste celular")).toBeTruthy();
  expect(
    jest.requireMock("../../../modules/replay-camera").isVoiceSupported,
  ).toHaveBeenCalledWith("pt-BR");
});

test("Gravações opens the game list, and is hidden during a game", async () => {
  session({});
  const view = await render(<Setup />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Gravações" }),
  );
  expect(router.push).toHaveBeenCalledWith("/games");

  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await view.rerender(<Setup />);
  expect(screen.queryByRole("button", { name: "Gravações" })).toBeNull();
});

test("voice on without speech permission shows Toque para ativar", async () => {
  repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: true } } });
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("undetermined");
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByLabelText("Voz, Toque para ativar")).toBeTruthy();
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("granted");
});

test("a denied speech permission shows the reason without a tap", async () => {
  repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: true } } });
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("denied");
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByLabelText("Voz, Negado · libere em Ajustes")).toBeTruthy();
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("granted");
});

test("opens on the camera: the three buttons and Gravar, no panel open and nothing drawn over the camera", async () => {
  session({});
  await render(<Setup />);
  expect(clipButton()).toBeTruthy();
  expect(qualityButton()).toBeTruthy();
  expect(triggersButton()).toBeTruthy();
  expect(recordButton()).toBeEnabled();
  expect(screen.getByRole("button", { name: "Gravações" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ajustes e conta" })).toBeTruthy();
  expect(screen.queryByText("MODO")).toBeNull();
  expect(screen.queryByTestId("triggers-panel")).toBeNull();
  expect(
    screen.queryByTestId("guide-person", { includeHiddenElements: true }),
  ).toBeNull();
  expect(screen.queryByLabelText(/^Voz,/)).toBeNull();
});

test("the buttons say what is set: the clip length, the quality and which triggers are on", async () => {
  repo.setPrefs({
    modeSettings: { quadra: { voiceEnabled: true, gestureEnabled: false } },
  });
  session({});
  await render(<Setup />);
  expect(screen.getByRole("button", { name: "Tamanho do clipe: 15 segundos" })).toBeTruthy();
  expect(screen.getByText("15s")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Qualidade: Full HD" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Gatilhos: Voz" })).toBeTruthy();
});

test("with no trigger on, the triggers button says so", async () => {
  repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: false, gestureEnabled: false } } });
  session({});
  await render(<Setup />);
  expect(screen.getByRole("button", { name: "Gatilhos: nenhum ligado" })).toBeTruthy();
  expect(screen.getByText("Gatilhos")).toBeTruthy();
});

test("Gravações and Ajustes sit beside Gravar: the game list and the account", async () => {
  session({});
  await render(<Setup />);
  await fireEvent.press(screen.getByRole("button", { name: "Ajustes e conta" }));
  expect(router.push).toHaveBeenCalledWith("/account");
});

test("the clip length options sit in their panel, with 15s picked by default (the free length)", async () => {
  session({});
  await render(<Setup />);
  await openClip();
  expect(screen.getByText("Tamanho do clipe")).toBeTruthy();
  expect(screen.getByText("Qual a duração do clipe que será salvo?")).toBeTruthy();
  expect(
    screen.getByText(
      "O app salva o lance depois que ele acontece, de acordo com a duração escolhida. No final, só os melhores lances ficam salvos.",
    ),
  ).toBeTruthy();
  for (const label of ["15s", "30s", "45s", "60s"])
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
  expect(screen.getByRole("button", { name: "30s" })).not.toBeSelected();
});

test("picking a clip length saves it for the next recordings, and the button shows it", async () => {
  session({});
  await render(<Setup />);
  await openClip();
  await fireEvent.press(screen.getByRole("button", { name: "45s" }));
  expect(repo.setPrefs).toHaveBeenCalledWith({
    modeSettings: { quadra: { cutSeconds: 45 } },
  });
  expect(screen.getByRole("button", { name: "45s" })).toBeSelected();
  expect(screen.getByRole("button", { name: "30s" })).not.toBeSelected();
  expect(screen.getByRole("button", { name: "Tamanho do clipe: 45 segundos" })).toBeTruthy();
});

test("the clip length picked before is the one selected when the screen opens", async () => {
  repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 15 } } });
  session({});
  await render(<Setup />);
  await openClip();
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
});

test("a remote press shows the remote works: it joins the triggers button", async () => {
  session({});
  await render(<Setup />);
  expect(triggersButton().props.accessibilityLabel).not.toMatch(/Controle/);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  const onPress = useVolumeRemote.mock.calls.at(-1)[1];
  await act(async () => onPress());
  expect(triggersButton().props.accessibilityLabel).toMatch(/^Gatilhos: Controle/);
});

test("a remote used in an earlier launch is not shown on until a press: it may have been unpaired since", async () => {
  const { StyleSheet } = jest.requireActual("react-native");
  const { colors } = jest.requireActual("../../theme/tokens");
  const statusColor = () =>
    StyleSheet.flatten(
      screen.getByText("Em espera · aperte um botão").props.style,
    ).color;

  session({});
  repo.setPrefs({ remoteTestedAt: 1 });
  await render(<Setup />);
  expect(triggersButton().props.accessibilityLabel).not.toMatch(/Controle/);
  await openTriggers();
  expect(statusColor()).not.toBe(colors.accent);
});

test("the positioning guide fits the camera area above the buttons", async () => {
  session({});
  await render(<Setup />);
  await fireEvent(screen.getByTestId("camera-bar"), "layout", {
    nativeEvent: { layout: { height: 210 } },
  });
  const { StyleSheet } = jest.requireActual("react-native");
  expect(
    StyleSheet.flatten(
      screen.getByTestId("guide-area", { includeHiddenElements: true }).props
        .style,
    ).bottom,
  ).toBe(210);
});

const camera = () => jest.requireMock("../../../modules/replay-camera");

test.each([
  ["unsupported", "Não pareado"],
  ["notInstalled", "Instale o app no Apple Watch"],
  ["ready", "Conectado"],
])('the Apple Watch says %s as "%s"', async (status, text) => {
  camera().getWatchStatus.mockReturnValue(status);
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByLabelText(`Apple Watch, ${text}`)).toBeTruthy();
});

test("a watch status event updates the trigger", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(
    screen.getByLabelText("Apple Watch, Não pareado"),
  ).toBeTruthy();
  const listener = camera().addReplayListener.mock.calls.find(
    (c: any[]) => c[0] === "onWatchStatus",
  )[1];
  camera().getWatchStatus.mockReturnValue("ready");
  await act(async () => listener({ status: "ready" }));
  expect(screen.getByLabelText("Apple Watch, Conectado")).toBeTruthy();
});

test("the triggers button shows a ready watch, and only then", async () => {
  session({});
  const view = await render(<Setup />);
  expect(triggersButton().props.accessibilityLabel).not.toMatch(/Apple Watch/);
  const listener = camera().addReplayListener.mock.calls.find(
    (c: any[]) => c[0] === "onWatchStatus",
  )[1];
  camera().getWatchStatus.mockReturnValue("ready");
  await act(async () => listener({ status: "ready" }));
  expect(triggersButton().props.accessibilityLabel).toMatch(/Apple Watch/);
  view.unmount();
});

// ---- The watch trigger is paid (Pro, or a game already paid with the Pass)

function freeTier() {
  jest.requireMock("../../share/entitlement").usePlan.mockReturnValue("free");
}

// ---- Video quality (Full HD / 4K) and battery saving

test("4K is offered on a phone that has it, and picking it is saved for the mode and shown on its button", async () => {
  session({});
  await render(<Setup />);
  await openQuality();
  expect(screen.getByText("Qualidade")).toBeTruthy();
  expect(screen.getByText("Qual a qualidade da gravação?")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Full HD, 60 quadros/s" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(screen.getByText(/^Full HD a 60 quadros\/s: movimentos mais fluidos/)).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "4K, 30 quadros/s" }));
  expect(repo.setPrefs).toHaveBeenLastCalledWith({
    modeSettings: { quadra: { quality: "2160p30" } },
  });
  expect(
    screen.getByRole("button", { name: "4K, 30 quadros/s" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(screen.getByText(/^4K a 30 quadros\/s: muito mais detalhe/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Qualidade: 4K" })).toBeTruthy();
});

test("a phone without 4K shows its quality but nothing to choose", async () => {
  camera().supportsQuality.mockReturnValue(false);
  session({});
  await render(<Setup />);
  expect(qualityButton()).toBeDisabled();
  expect(screen.queryByTestId("quality-panel")).toBeNull();
  camera().supportsQuality.mockReturnValue(true);
});

test("on the free tier 4K carries the Pro badge, opens the paywall and the game stays in Full HD", async () => {
  freeTier();
  repo.setPrefs({ modeSettings: { quadra: { quality: "2160p30" } } });
  session({});
  await render(<Setup />);
  expect(screen.getByRole("button", { name: "Qualidade: Full HD" })).toBeTruthy();
  await openQuality();
  expect(
    screen.getByRole("button", { name: "Full HD, 60 quadros/s" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(screen.getAllByText("PRO")).toHaveLength(1);
  await fireEvent.press(
    screen.getByRole("button", { name: "4K, 30 quadros/s, Disponível no PRO" }),
  );
  expect(openPaywall).toHaveBeenCalledTimes(1);
  expect(openPaywall).toHaveBeenCalledWith(
    expect.any(Function),
    "locked_feature",
  );
  expect(jest.requireMock("../../analytics").track).toHaveBeenCalledWith(
    "pro_feature_blocked",
    { feature: "quality_4k" },
  );
});

test("battery saving is only on the recording screen: the setup screen has no switch for it (2026-11-20)", async () => {
  session({});
  await render(<Setup />);
  expect(screen.queryByRole("switch", { name: "Economia de bateria" })).toBeNull();
});

test("the triggers panel has no battery row", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.queryByText("BATERIA")).toBeNull();
});

test.each([
  ["unsupported", "Não pareado", /Pareie um Apple Watch/],
  [
    "notInstalled",
    "Instale o app no Apple Watch",
    /^No iPhone, abra o app Watch/,
  ],
])(
  "a %s watch is not greyed out: the tile explains how to set it up",
  async (status, text, help) => {
    camera().getWatchStatus.mockReturnValue(status);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    session({});
    await render(<Setup />);
    await openTriggers();
    const tile = screen.getByRole("button", { name: `Apple Watch, ${text}` });
    expect(tile).toBeEnabled();
    await fireEvent.press(tile);
    expect(alert).toHaveBeenCalledWith(
      "Usar o Apple Watch",
      expect.stringMatching(help),
    );
    expect(openPaywall).not.toHaveBeenCalled();
    alert.mockRestore();
  },
);

test("the watch status is read again on the next render: an activation that finished unheard still shows", async () => {
  session({});
  await render(<Setup />);
  camera().getWatchStatus.mockReturnValue("ready"); // no event: it fired before the screen listened
  await openTriggers();
  expect(screen.getByLabelText("Apple Watch, Conectado")).toBeTruthy();
});

test("on the free tier the Apple Watch tile shows a Pro badge and opens the paywall", async () => {
  freeTier();
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  await openTriggers();
  // Only the Apple Watch is paid among the triggers (2026-11-22): one "Pro" mark in the panel.
  expect(screen.getAllByText("PRO")).toHaveLength(1);
  const tile = screen.getByRole("button", {
    name: "Apple Watch, Disponível no PRO",
  });
  await fireEvent.press(tile);
  expect(openPaywall).toHaveBeenCalledTimes(1);
  expect(openPaywall.mock.calls[0]).toHaveLength(2);
  expect(openPaywall.mock.calls[0][0]("setup.watchProOnly")).toBe(
    "Disponível no PRO",
  );
  expect(openPaywall.mock.calls[0][1]).toBe("locked_feature");
  expect(jest.requireMock("../../analytics").track).toHaveBeenCalledWith(
    "pro_feature_blocked",
    { feature: "watch" },
  );
});

test("on the free tier clip lengths above 15s are locked and open the paywall", async () => {
  freeTier();
  session({});
  await render(<Setup />);
  await openClip(); // 15s by default; the longer lengths are Pro
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
  // The paid lengths share one "Pro" mark (2026-11-22), not one each.
  expect(screen.getAllByText("PRO")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "30s, Disponível no PRO" }),
  ).not.toBeSelected();
  for (const label of ["30s", "45s", "60s"]) {
    openPaywall.mockClear();
    await fireEvent.press(
      screen.getByRole("button", { name: `${label}, Disponível no PRO` }),
    );
    expect(openPaywall).toHaveBeenCalledTimes(1);
    expect(jest.requireMock("../../analytics").track).toHaveBeenCalledWith(
      "pro_feature_blocked",
      { feature: "clip_length" },
    );
  }
  expect(repo.setPrefs).not.toHaveBeenCalledWith(
    expect.objectContaining({ modeSettings: expect.anything() }),
  );
});

test("on the free tier picking 15s is free and saves it", async () => {
  freeTier();
  session({});
  await render(<Setup />);
  await openClip();
  await fireEvent.press(screen.getByRole("button", { name: "15s" }));
  expect(openPaywall).not.toHaveBeenCalled();
  expect(repo.setPrefs).toHaveBeenCalledWith({
    modeSettings: { quadra: { cutSeconds: 15 } },
  });
});

test("on the free tier the Bluetooth remote tile is free: no lock, it opens the remote sheet", async () => {
  freeTier();
  camera().isRemoteSupported.mockReturnValue(true);
  camera().isRemoteControllerSupported.mockReturnValue(true);
  session({});
  await render(<Setup />);
  await openTriggers();
  router.push.mockClear?.();
  expect(
    screen.queryByRole("button", {
      name: /^Controle.*Disponível no PRO$/,
    }),
  ).toBeNull();
  await fireEvent.press(screen.getByRole("button", { name: /^Controle,/ }));
  expect(openPaywall).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/devices",
    params: { kind: "remote" },
  });
});

test("on the free tier a locked watch is not counted as on in the triggers button", async () => {
  freeTier();
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  expect(triggersButton().props.accessibilityLabel).not.toMatch(/Apple Watch/);
});

test("on Pro the Apple Watch has no badge and no paywall", async () => {
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.queryByText("PRO")).toBeNull();
  expect(screen.getByLabelText("Apple Watch, Conectado")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Apple Watch/ })).toBeNull();
});

test("every trigger that is on says so in the same green as Conectado (2026-11-22)", async () => {
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  await openTriggers();
  const { StyleSheet } = jest.requireActual("react-native");
  const green = StyleSheet.flatten(screen.getByText("Conectado").props.style).color;
  const wave = () => screen.getByRole("button", { name: /^Aceno,/ });
  expect(StyleSheet.flatten(within(wave()).getByText("Ativo").props.style).color).toBe(green);
  await fireEvent.press(wave());
  expect(StyleSheet.flatten(within(wave()).getByText("Desligado").props.style).color).not.toBe(green);
});

test("without a watch the other triggers behave as before", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(screen.getByLabelText("Aceno, Ativo")).toBeTruthy();
  expect(recordButton()).toBeEnabled();
});

// ---- Second iPhone as a remote ("Celular" tile)

function enableRemote(peers: { id: string; name: string }[]) {
  camera().isRemoteSupported.mockReturnValue(true);
  camera().isRemoteControllerSupported.mockReturnValue(true);
  camera().remoteHostPeers.mockReturnValue(peers);
}

/** Opens the "Celular" trigger's own panel. */
async function openPhonePanel(name: RegExp | string = /^Celular,/) {
  await fireEvent.press(within(screen.getByTestId("more-triggers")).getByRole("button", { name }));
  return screen.getByTestId("phone-panel");
}

test("another phone as a remote is one of the triggers (2026-11-22): Celular opens its panel with the two ways round", async () => {
  enableRemote([]);
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(within(screen.getByTestId("more-triggers")).getByRole("button", { name: "Celular, Não conectado" })).toBeTruthy();
  const phone = await openPhonePanel();
  expect(screen.queryByTestId("triggers-panel")).toBeNull();
  await fireEvent.press(within(phone).getByRole("button", { name: /^Conectar outro celular,/ }));
  expect(router.push).toHaveBeenCalledWith("/pairing");
  await fireEvent.press(within(phone).getByRole("button", { name: /^Usar este celular como controle,/ }));
  expect(router.push).toHaveBeenCalledWith("/remote");
  expect(within(phone).queryByRole("button", { name: "Desconectar deste celular" })).toBeNull();
  await fireEvent.press(within(phone).getByRole("button", { name: "Fechar" }));
  expect(screen.getByTestId("triggers-panel")).toBeTruthy();
});

test("without the phone remote on this phone there is no Celular trigger", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(within(screen.getByTestId("more-triggers")).queryByRole("button", { name: /^Celular,/ })).toBeNull();
});

test("linked remotes light Celular in amber, say how many, and show in the triggers button and in its panel", async () => {
  enableRemote([{ id: "a", name: "iPhone da Ana" }]);
  camera().remoteHostControllers.mockReturnValue(1);
  session({});
  await render(<Setup />);
  expect(triggersButton().props.accessibilityLabel).toMatch(/Celular/);
  await openTriggers();
  expect(screen.getByRole("button", { name: "Celular, 1 controle conectado" })).toBeSelected();
  const phone = await openPhonePanel();
  expect(within(phone).getByRole("button", { name: /^Conectar outro celular, .*, 1 controle conectado$/ })).toBeSelected();
  camera().remoteHostControllers.mockReturnValue(0);
});

test("a phone paired as a remote says with which camera, and Desconectar asks first, then forgets it", async () => {
  enableRemote([]);
  camera().remoteControllerHost.mockReturnValue({ id: "h1", name: "iPhone XR#1234" });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  session({});
  await render(<Setup />);
  await openTriggers();
  const phone = await openPhonePanel("Celular, Pareado");
  expect(within(phone).getByRole("button", { name: /^Usar este celular como controle, .*, Pareado com iPhone XR#1234$/ })).toBeSelected();
  await fireEvent.press(within(phone).getByRole("button", { name: "Desconectar deste celular" }));
  expect(camera().remoteControllerForget).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === "Esquecer")!.onPress!());
  expect(camera().remoteControllerForget).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Desconectar deste celular" })).toBeNull();
  alert.mockRestore();
});

test("on its side the phone remote is there too", async () => {
  enableRemote([]);
  camera().getDeviceUpright.mockReturnValue("landscapeLeft");
  session({});
  await render(<Setup />);
  await openTriggers();
  await openPhonePanel("Celular, Não conectado");
  expect(within(screen.getByTestId("landscape-frame")).getByTestId("phone-panel")).toBeTruthy();
});

test("the setup screen does not start or stop the host: it lives as long as the app is open (root layout)", async () => {
  enableRemote([{ id: "a", name: "iPhone da Ana" }]);
  session({});
  const view = await render(<Setup />);
  await view.unmount();
  expect(camera().remoteHostStart).not.toHaveBeenCalled();
  expect(camera().remoteHostStop).not.toHaveBeenCalled();
});

test('the Bluetooth remote starts as "Toque para conectar" and opens the Dispositivos sheet on the remote', async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  await fireEvent.press(
    screen.getByRole("button", { name: "Controle, Toque para conectar" }),
  );
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/devices",
    params: { kind: "remote" },
  });
});

test('the Bluetooth remote tile asks for a press when the remote was used before, and says "Conectado" after one', async () => {
  repo.setPrefs({ remoteTestedAt: 123 });
  session({});
  await render(<Setup />);
  await openTriggers();
  expect(
    screen.getByRole("button", {
      name: "Controle, Em espera · aperte um botão",
    }),
  ).toBeTruthy();
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  await act(async () => useVolumeRemote.mock.calls.at(-1)[1]());
  expect(
    screen.getByRole("button", { name: "Controle, Conectado" }),
  ).toBeTruthy();
});

test("the remote held 2 s starts a recording, answered by its own sound and torch (2026-11-07)", async () => {
  const s = session({});
  s.start.mockResolvedValue("started");
  await render(<Setup />);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  const { onHold } = useVolumeRemote.mock.calls.at(-1)[2];
  await act(async () => onHold());
  expect(s.start).toHaveBeenCalled();
  const native = jest.requireMock("../../../modules/replay-camera");
  expect(native.signalAction).toHaveBeenCalledWith("started", {
    sound: true,
    flash: true,
  });
});

test("a start from the remote that fails answers with the failure beep", async () => {
  const s = session({});
  s.start.mockResolvedValue("failed");
  await render(<Setup />);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  await act(async () => useVolumeRemote.mock.calls.at(-1)[2].onHold());
  const native = jest.requireMock("../../../modules/replay-camera");
  expect(native.signalAction).not.toHaveBeenCalled();
  expect(native.signalSaveFailed).toHaveBeenCalledWith({ sound: true });
});

test("coming back to the camera after a game (Gravações has no Nova gravação) starts clean", async () => {
  const focused = jest.requireMock("expo-router").useIsFocused;
  focused.mockReturnValue(false); // under Gravações
  const s = session({ phase: "ended", sessionId: "s1" });
  const view = await render(<Setup />);
  expect(s.reset).not.toHaveBeenCalled();
  focused.mockReturnValue(true); // back
  await view.rerender(<Setup />);
  expect(s.reset).toHaveBeenCalledTimes(1);
});

test("the moment a game ends here, the screen does not reset it (it moves on to the clips)", async () => {
  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  const view = await render(<Setup />);
  const ended = session({ phase: "ended", sessionId: "s1" });
  await view.rerender(<Setup />);
  expect(ended.reset).not.toHaveBeenCalled();
});

test("back on this screen with the camera off after a recording ended from the remote, the camera comes back", async () => {
  const s = session({ phase: "idle", camera: "off" });
  await render(<Setup />);
  expect(s.prepare).toHaveBeenCalled();
});

test("a press heard in the Dispositivos sheet shows on the tile when coming back", async () => {
  session({});
  await render(<Setup />);
  await openTriggers();
  await act(async () => require("../../devices/remoteTest").markRemotePress());
  expect(
    screen.getByRole("button", { name: "Controle, Conectado" }),
  ).toBeTruthy();
});

test("the Dispositivos sheet over the setup keeps the camera and the volume buttons on this screen", async () => {
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(false);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  const { setRemoteSheetOpen } = require("../../devices/remoteTest");
  const s = session({});
  await render(<Setup />);
  expect(useVolumeRemote).toHaveBeenLastCalledWith(
    false,
    expect.any(Function),
    expect.anything(),
  );
  await act(async () => setRemoteSheetOpen(true));
  expect(useVolumeRemote).toHaveBeenLastCalledWith(
    true,
    expect.any(Function),
    expect.anything(),
  );
  expect(s.prepare).toHaveBeenCalled();
  await act(async () => setRemoteSheetOpen(false));
  expect(useVolumeRemote).toHaveBeenLastCalledWith(
    false,
    expect.any(Function),
    expect.anything(),
  );
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(true);
});

test("no status line about the plan: neither a free count nor a Pass", async () => {
  session({});
  await render(<Setup />);
  expect(screen.queryByText(/Passe/)).toBeNull();
  expect(screen.queryByText(/grátis/)).toBeNull();
});

const pressStart = () => fireEvent.press(recordButton());

test("a started recording never opens the paywall", async () => {
  const s = session({});
  s.start.mockResolvedValue("started");
  await render(<Setup />);
  await pressStart();
  expect(s.start).toHaveBeenCalledTimes(1);
  expect(openPaywall).not.toHaveBeenCalled();
});

test("a start that fails never opens the paywall either", async () => {
  const s = session({});
  s.start.mockResolvedValue("failed");
  await render(<Setup />);
  await pressStart();
  expect(s.start).toHaveBeenCalledTimes(1);
  expect(openPaywall).not.toHaveBeenCalled();
});

test("a double tap while start is pending starts once", async () => {
  const s = session({});
  s.start.mockReturnValue(new Promise(() => {}));
  await render(<Setup />);
  await pressStart();
  await pressStart();
  expect(s.start).toHaveBeenCalledTimes(1);
});

describe("phone held on its side (2026-11-22, layout L1)", () => {
  beforeEach(() =>
    jest
      .requireMock("../../../modules/replay-camera")
      .getDeviceUpright.mockReturnValue("landscapeLeft"),
  );

  test("the bar stays where it is on the phone and only its contents turn (2026-11-22): nothing moves or flashes", async () => {
    session({});
    await render(<Setup />);
    const frame = screen.getByTestId("landscape-frame");
    const { StyleSheet } = jest.requireActual("react-native");
    expect(StyleSheet.flatten(frame.props.style).transform).toEqual([{ rotate: "90deg" }]);
    // The same bar as upright, outside the turned frame (which only holds the panels and the notes).
    expect(within(frame).queryByTestId("camera-bar")).toBeNull();
    expect(screen.getByTestId("camera-bar")).toBeTruthy();
    for (const button of [clipButton(), qualityButton(), triggersButton(), recordButton()]) expect(button).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gravações" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ajustes e conta" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajustes" })).toBeNull();
    expect(zoomButton("Zoom 1x")).toBeTruthy();
  });

  test("the other way round, the frame turns the other way", async () => {
    camera().getDeviceUpright.mockReturnValue("landscapeRight");
    session({});
    await render(<Setup />);
    const { StyleSheet } = jest.requireActual("react-native");
    expect(StyleSheet.flatten(screen.getByTestId("landscape-frame").props.style).transform).toEqual([{ rotate: "-90deg" }]);
  });

  test("on its side the settings read top to bottom: clip length, quality, triggers (2026-11-22)", async () => {
    session({});
    await render(<Setup />);
    const { StyleSheet } = jest.requireActual("react-native");
    // Home bar on the right: the phone's left end is at the bottom, so the row runs the other way.
    expect(StyleSheet.flatten(screen.getByTestId("camera-settings").props.style).flexDirection).toBe("row-reverse");
  });

  test("the other way round, the settings keep the upright order, which already reads top to bottom", async () => {
    camera().getDeviceUpright.mockReturnValue("landscapeRight");
    session({});
    await render(<Setup />);
    const { StyleSheet } = jest.requireActual("react-native");
    expect(StyleSheet.flatten(screen.getByTestId("camera-settings").props.style).flexDirection).toBe("row");
  });

  test("the zoom stays at the top of the screen, as upright, only its text turned to stand upright", async () => {
    session({});
    await render(<Setup />);
    const dock = screen.getByTestId("zoom-dock");
    expect(within(screen.getByTestId("landscape-frame")).queryByTestId("zoom-dock")).toBeNull();
    const { StyleSheet } = jest.requireActual("react-native");
    const button = within(dock).getByRole("button", { name: "Zoom 1x" });
    // Some view between the dock and the button turns it a quarter.
    let node = button.parent;
    let turned = false;
    while (node !== null && node !== dock) {
      const style = StyleSheet.flatten(node.props.style);
      if (style !== undefined && style !== null && JSON.stringify(style.transform) === JSON.stringify([{ rotate: "90deg" }])) turned = true;
      node = node.parent;
    }
    expect(turned).toBe(true);
  });

  test("Gravar starts the game with the mode", async () => {
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(recordButton());
    expect(s.start).toHaveBeenCalledWith("quadra");
  });

  test("each setting opens its panel beside the column; a tap on the camera closes it, Gravar closes it and records", async () => {
    const s = session({});
    await render(<Setup />);
    await openTriggers();
    expect(within(screen.getByTestId("landscape-frame")).getByTestId("triggers-panel")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zoom 1x" })).toBeNull();
    await fireEvent.press(screen.getByTestId("panel-backdrop"));
    expect(screen.queryByTestId("triggers-panel")).toBeNull();
    await openClip();
    await fireEvent.press(recordButton());
    expect(screen.queryByTestId("clip-panel")).toBeNull();
    expect(s.start).toHaveBeenCalledWith("quadra");
  });

  test("a swipe follows the panel's own direction: on the turned screen, left is up", async () => {
    session({});
    await render(<Setup />);
    await openClip();
    const panel = screen.getByTestId("clip-panel");
    const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });
    await fireEvent(panel, "touchStart", at(300, 600));
    // Sideways on the screen is up or down for the panel: not a swipe.
    expect(panel.props.onMoveShouldSetResponderCapture(at(550, 600))).toBe(false);
    expect(panel.props.onMoveShouldSetResponderCapture(at(300, 300))).toBe(true);
    await fireEvent(panel, "responderMove", at(300, 300));
    await fireEvent(panel, "responderRelease", at(300, 300));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(screen.getByTestId("quality-panel")).toBeTruthy();
  });

  test("Gravar waits while the camera opens", async () => {
    session({ camera: "starting" });
    await render(<Setup />);
    expect(recordButton()).toBeDisabled();
  });

  test("why a start failed shows beside the column", async () => {
    session({ phase: "idle", error: "LOW_STORAGE" });
    await render(<Setup />);
    expect(
      within(screen.getByTestId("landscape-frame")).getByText(
        "Pouco espaço no celular. Libere pelo menos 500 MB para gravar.",
      ),
    ).toBeTruthy();
  });
});

test("held upright the camera keeps its bar under the picture, not turned", async () => {
  session({});
  await render(<Setup />);
  expect(screen.getByTestId("camera-bar")).toBeTruthy();
  expect(screen.queryByTestId("landscape-frame")).toBeNull();
});

test("the setup never rests: after minutes without a touch the camera stays on (2026-11-20, only a recording rests)", async () => {
  jest.useFakeTimers();
  try {
    session({});
    await render(<Setup />);
    await act(async () => jest.advanceTimersByTime(120_000));
    expect(screen.queryByTestId("idle-warning")).toBeNull();
    expect(screen.queryByTestId("camera-paused")).toBeNull();
    const native = jest.requireMock("../../../modules/replay-camera");
    expect(native.setScreenEconomy).not.toHaveBeenCalledWith(true);
    expect(native.setCameraIdle).not.toHaveBeenCalledWith(true);
  } finally {
    jest.useRealTimers();
  }
});

test("coming back from another app, a remote shown as connected goes back to paired until it is pressed again", async () => {
  const { markRemotePress } = require("../../devices/remoteTest");
  const listeners: ((s: string) => void)[] = [];
  // Swapped by hand and put back in `finally`: jest.spyOn + mockRestore leaves React Native's AppState mock returning
  // undefined, and no screen rendered afterwards can unmount (the tests after this one failed on `sub.remove`).
  const { AppState } = require("react-native");
  const original = AppState.addEventListener;
  AppState.addEventListener = (_: string, fn: (s: string) => void) => {
    listeners.push(fn);
    return { remove: () => {} };
  };
  try {
    session({});
    const view = await render(<Setup />);
    await act(async () => markRemotePress());
    expect(require("../../devices/remoteTest").hasRemotePress()).toBe(true);
    await act(async () => listeners.forEach((fn) => fn("active")));
    expect(require("../../devices/remoteTest").hasRemotePress()).toBe(false);
    view.unmount();
  } finally {
    AppState.addEventListener = original;
  }
});

// ---- The camera's panels (2026-11-22, after Lens Buddy)

describe("panels over the camera", () => {
  test("each button opens its panel and turns amber; the same button, ✕ or a tap on the camera close it", async () => {
    session({});
    await render(<Setup />);
    await openClip();
    expect(screen.getByTestId("clip-panel")).toBeTruthy();
    expect(clipButton()).toBeSelected();
    await openClip();
    expect(screen.queryByTestId("clip-panel")).toBeNull();
    expect(clipButton()).not.toBeSelected();
    await openQuality();
    expect(screen.getByTestId("quality-panel")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByTestId("quality-panel")).toBeNull();
    await openTriggers();
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("panel-backdrop"));
    expect(screen.queryByTestId("triggers-panel")).toBeNull();
  });

  test("another button goes straight to its own panel", async () => {
    session({});
    await render(<Setup />);
    await openClip();
    await openTriggers();
    expect(screen.queryByTestId("clip-panel")).toBeNull();
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    expect(triggersButton()).toBeSelected();
  });

  test("Gravar with a panel open closes it and starts", async () => {
    const s = session({});
    await render(<Setup />);
    await openTriggers();
    await fireEvent.press(recordButton());
    expect(screen.queryByTestId("triggers-panel")).toBeNull();
    expect(s.start).toHaveBeenCalledWith("quadra");
  });

  test("a recording that starts (from the remote too) closes the panel", async () => {
    session({});
    const view = await render(<Setup />);
    await openClip();
    session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
    await view.rerender(<Setup />);
    session({});
    await view.rerender(<Setup />);
    expect(screen.queryByTestId("clip-panel")).toBeNull();
  });
});

describe("swiping sideways between the panels (2026-11-22)", () => {
  const at = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y } });
  /** The panel leaving and the next one coming in (the clip screen's slide). */
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
  /** A finger from (300, 400) dragging by (dx, dy) and lifting: whether the panel took it. */
  const swipe = async (dx: number, dy = 0) => {
    const panel = screen.getByTestId(/-panel$/);
    await fireEvent(panel, "touchStart", at(300, 400));
    const took = panel.props.onMoveShouldSetResponderCapture(at(300 + dx, 400 + dy));
    if (took) {
      await fireEvent(panel, "responderMove", at(300 + dx, 400 + dy));
      await fireEvent(panel, "responderRelease", at(300 + dx, 400 + dy));
      await settle();
    }
    return took;
  };

  test("left goes to the next setting, right to the previous; the ends stay put and the button follows", async () => {
    session({});
    await render(<Setup />);
    await openClip();
    await swipe(-250);
    expect(screen.getByTestId("quality-panel")).toBeTruthy();
    expect(qualityButton()).toBeSelected();
    await swipe(-250);
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    await swipe(-250); // the last one
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    await swipe(250);
    expect(screen.getByTestId("quality-panel")).toBeTruthy();
    await swipe(250);
    await swipe(250); // the first one
    expect(screen.getByTestId("clip-panel")).toBeTruthy();
  });

  test("a short or mostly vertical move does not change panel (taps and the scroll keep working)", async () => {
    session({});
    await render(<Setup />);
    await openClip();
    expect(await swipe(-10)).toBe(false);
    expect(await swipe(-60, 80)).toBe(false);
    expect(await swipe(-30)).toBe(true); // taken and followed, but not far enough: it goes back
    expect(screen.getByTestId("clip-panel")).toBeTruthy();
  });

  test("without 4K a swipe goes from the clip length straight to the triggers", async () => {
    camera().supportsQuality.mockReturnValue(false);
    session({});
    await render(<Setup />);
    await openClip();
    await swipe(-250);
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    camera().supportsQuality.mockReturnValue(true);
  });

  test("the trigger test does not follow a swipe", async () => {
    session({});
    await render(<Setup />);
    await openTriggers();
    await fireEvent.press(screen.getByRole("button", { name: "Testar gatilhos" }));
    expect(screen.getByTestId("trigger-test").props.onResponderRelease).toBeUndefined();
  });
});

describe("Testar gatilhos (2026-11-22)", () => {
  const openTest = async () => {
    await openTriggers();
    await fireEvent.press(screen.getByRole("button", { name: "Testar gatilhos" }));
  };

  test("lists the triggers that are on; each turns to Funcionou when used, and nothing is saved", async () => {
    repo.setPrefs({
      remoteTestedAt: 1,
      modeSettings: { quadra: { voiceEnabled: true, gestureEnabled: true } },
    });
    const cam = camera();
    cam.setGestureEnabled.mockClear();
    cam.setVoiceEnabled.mockClear();
    const s = session({});
    await render(<Setup />);
    await openTest();
    expect(screen.getByTestId("trigger-test")).toBeTruthy();
    expect(triggersButton()).toBeSelected();
    expect(screen.getByLabelText("Aperte o controle, Esperando…")).toBeTruthy();
    expect(screen.getByLabelText("Diga “salvar”, Esperando…")).toBeTruthy();
    expect(screen.getByLabelText("Acene para a câmera, Esperando…")).toBeTruthy();
    expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(true);
    expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(true, "pt-BR");

    // The camera sees a wave: only that row changes, with the saved-clip chime.
    const heard = cam.addReplayListener.mock.calls
      .filter((c: any[]) => c[0] === "onTrigger")
      .map((c: any[]) => c[1]);
    await act(async () => heard.forEach((fn: any) => fn({ source: "gesture", at: 1 })));
    expect(screen.getByLabelText("Acene para a câmera, Funcionou")).toBeTruthy();
    expect(screen.getByLabelText("Diga “salvar”, Esperando…")).toBeTruthy();
    expect(cam.signalSaved).toHaveBeenCalledWith({ sound: true, flash: false });

    // A remote press.
    cam.signalSaved.mockClear();
    const { useVolumeRemote } = jest.requireMock("../../triggers/useVolumeRemote");
    await act(async () => useVolumeRemote.mock.calls.at(-1)[1]());
    expect(screen.getByLabelText("Aperte o controle, Funcionou")).toBeTruthy();
    expect(cam.signalSaved).toHaveBeenCalledWith({ sound: true, flash: false });
    expect(s.trigger).not.toHaveBeenCalled();
    expect(s.start).not.toHaveBeenCalled();

    // Concluir: back to the triggers, and the camera stops listening.
    await fireEvent.press(screen.getByRole("button", { name: "Concluir" }));
    expect(screen.getByTestId("triggers-panel")).toBeTruthy();
    expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(false);
    expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(false, "pt-BR");
  });

  test("a remote press outside the test makes no sound", async () => {
    session({});
    await render(<Setup />);
    const { useVolumeRemote } = jest.requireMock("../../triggers/useVolumeRemote");
    await act(async () => useVolumeRemote.mock.calls.at(-1)[1]());
    expect(camera().signalSaved).not.toHaveBeenCalled();
  });

  test("a remote never used on this phone is left out (it would wait forever); a connected watch shows its link", async () => {
    camera().getWatchStatus.mockReturnValue("ready");
    repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: false, gestureEnabled: false } } });
    session({});
    await render(<Setup />);
    await openTest();
    expect(screen.queryByLabelText(/^Aperte o controle/)).toBeNull();
    expect(screen.getByLabelText("Apple Watch, Conectado")).toBeTruthy();
    expect(screen.getByText("É só um teste: nenhum clipe é salvo. Quando um gatilho funciona, toca o mesmo aviso de clipe salvo.")).toBeTruthy();
  });

  test("with no trigger on it says to turn one on", async () => {
    repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: false, gestureEnabled: false } } });
    session({});
    await render(<Setup />);
    await openTest();
    expect(screen.getByText("Ligue um gatilho para testar.")).toBeTruthy();
  });
});

test('the clip length reads with a small "s" for seconds, the other settings in capitals (2026-11-22)', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  session({});
  await render(<Setup />);
  const seconds = screen.getAllByText(/^\d+s$/)[0];
  expect(StyleSheet.flatten(seconds.props.style).textTransform).toBe('none');
});

describe('continuing a recording from its menu (2026-11-23)', () => {
  const { setContinueIntent, continueIntent } = jest.requireActual('../../session/continueIntent');
  const final = (endedAgoMin: number) => ({ id: 's1', sport: 'quadra', startedAt: 0, endedAt: Date.now() - endedAgoMin * 60_000, name: 'Final' });
  afterEach(() => {
    setContinueIntent(undefined);
    repo.getSession.mockReturnValue(undefined);
    repo.allSessions.mockReturnValue([]);
  });

  test('the camera says which recording goes on, and Gravar continues it instead of starting a new one', async () => {
    repo.getSession.mockReturnValue(final(20));
    repo.allSessions.mockReturnValue([final(20)]);
    setContinueIntent('s1');
    const s = session({});
    await render(<Setup />);
    expect(screen.getByText('Continuando · Final')).toBeTruthy();
    await fireEvent.press(recordButton());
    expect(s.continueRecording).toHaveBeenCalledWith('s1');
    expect(s.start).not.toHaveBeenCalled();
    expect(continueIntent()).toBeUndefined();
  });

  test('the ✕ on the badge drops it: Gravar starts a new recording', async () => {
    repo.getSession.mockReturnValue(final(20));
    repo.allSessions.mockReturnValue([final(20)]);
    setContinueIntent('s1');
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(screen.getByRole('button', { name: 'Não continuar' }));
    expect(screen.queryByText('Continuando · Final')).toBeNull();
    await fireEvent.press(recordButton());
    expect(s.start).toHaveBeenCalledWith('quadra');
    expect(s.continueRecording).not.toHaveBeenCalled();
  });

  test('the hour ran out while the camera waited: Gravar asks, and only a new recording can start', async () => {
    const { currentDialog, closeDialog } = jest.requireActual('../../components/dialog');
    repo.getSession.mockReturnValue(final(61));
    repo.allSessions.mockReturnValue([final(61)]);
    setContinueIntent('s1');
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(recordButton());
    expect(s.continueRecording).not.toHaveBeenCalled();
    const dialog = currentDialog();
    expect(dialog).toMatchObject({ title: 'O tempo para continuar acabou', confirm: 'Nova gravação' });
    await act(async () => {
      closeDialog();
      dialog.onConfirm();
    });
    expect(s.start).toHaveBeenCalledWith('quadra');
    expect(continueIntent()).toBeUndefined();
  });
});
