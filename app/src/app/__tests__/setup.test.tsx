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
    isRemoteSupported: jest.fn(() => false),
    supportsQuality: jest.fn(() => true),
    setScreenEconomy: jest.fn(),
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
  };
  let prefs: any = { ...initial };
  return {
    __reset: () => (prefs = { ...initial }),
    repo: {
      getPrefs: () => prefs,
      setPrefs: jest.fn((p: object) => (prefs = { ...prefs, ...p })),
      subscribe: jest.fn(() => () => {}),
      version: jest.fn(() => 0),
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
    prepare: jest.fn(async () => true),
    release: jest.fn(async () => {}),
    trigger: jest.fn(),
    setZoom: jest.fn(),
    undoLast: jest.fn(),
    stop: jest.fn(async () => "s1"),
  };
  useSession.mockReturnValue(value);
  return value;
}

/** The setup sheet opens collapsed: mode, triggers and alerts sit behind the summary row. */
async function openSettings() {
  await fireEvent.press(screen.getByRole("button", { name: /^Ajustes:/ }));
}

beforeEach(() => {
  // A tap on the remote tile counts the sheet as opening for a moment: never carry it into the next test.
  setRemoteSheetOpen(false);
  jest.clearAllMocks();
  jest.requireMock("../../data/mmkv").__reset();
  clearRemotePress();
  const module = jest.requireMock("../../../modules/replay-camera");
  module.isRemoteSupported.mockReturnValue(false);
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
  expect(useVolumeRemote).toHaveBeenLastCalledWith(false, expect.any(Function));
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

  test("a bubble shows the value while pinching and goes away shortly after the fingers lift", async () => {
    jest.useFakeTimers();
    session({});
    await render(<Setup />);
    expect(screen.queryByTestId("zoom-bubble")).toBeNull();
    const area = screen.getByTestId("zoom-pinch");
    await fireEvent(area, "responderGrant", two(100));
    await fireEvent(area, "responderMove", two(150));
    expect(screen.getByTestId("zoom-bubble")).toBeTruthy();
    expect(screen.getByTestId("zoom-bubble")).toHaveTextContent("1.5x");
    await fireEvent(area, "responderRelease", one);
    expect(screen.getByTestId("zoom-bubble")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(900));
    expect(screen.queryByTestId("zoom-bubble")).toBeNull();
    jest.useRealTimers();
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

test("shows that the camera is opening", async () => {
  session({ camera: "starting" });
  await render(<Setup />);
  expect(
    screen.getByRole("button", { name: "Abrindo a câmera…" }),
  ).toBeDisabled();
});

test("the wave gesture's ? opens how to do it and practises with the camera, which stops looking once it closes", async () => {
  const cam = jest.requireMock("../../../modules/replay-camera");
  cam.setGestureEnabled.mockClear();
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: "Como fazer o gesto" }),
  );
  expect(screen.getByText("Como acenar")).toBeTruthy();
  expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(true);
  await fireEvent.press(screen.getByRole("button", { name: "Fechar" }));
  expect(screen.queryByText("Como acenar")).toBeNull();
  expect(cam.setGestureEnabled).toHaveBeenLastCalledWith(false);
  expect(
    jest.requireMock("../../analytics").sessionSummary.note,
  ).toHaveBeenCalledWith("guide");
});

test("the voice's ? opens how to use it and practises listening, which stops once it closes", async () => {
  const cam = jest.requireMock("../../../modules/replay-camera");
  cam.setVoiceEnabled.mockClear();
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: "Como usar a voz" }),
  );
  expect(screen.getByText("Diga “salvar” em voz alta.")).toBeTruthy();
  expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(true, expect.anything());
  await fireEvent.press(screen.getByRole("button", { name: "Fechar" }));
  expect(cam.setVoiceEnabled).toHaveBeenLastCalledWith(
    false,
    expect.anything(),
  );
});

test('the Bluetooth remote and the Apple Watch come first, under "Recomendados" with why, then the other triggers', async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByText("GATILHOS RECOMENDADOS")).toBeTruthy();
  expect(
    screen.getByText("Para melhores resultados nas gravações."),
  ).toBeTruthy();
  expect(screen.getByText("OUTROS GATILHOS")).toBeTruthy();
  expect(screen.queryByText("GATILHOS")).toBeNull();
  const recommended = screen.getByTestId("recommended-triggers");
  expect(
    within(recommended).getByRole("button", { name: /^Controle Bluetooth/ }),
  ).toBeTruthy();
  expect(within(recommended).getByLabelText(/^Apple Watch/)).toBeTruthy();
  expect(
    within(recommended).queryByRole("button", { name: /^Voz/ }),
  ).toBeNull();
});

test("on Android there is no Apple Watch or voice tile, nor their icons in the summary", async () => {
  const os = Platform.OS;
  Platform.OS = "android";
  try {
    session({});
    await render(<Setup />);
    expect(
      screen.getByLabelText(/^Ajustes:/).props.accessibilityLabel,
    ).not.toMatch(/voz/i);
    await openSettings();
    expect(screen.queryByLabelText(/^Apple Watch/)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Voz/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Controle Bluetooth/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Acenar/ })).toBeTruthy();
  } finally {
    Platform.OS = os;
  }
});

test("opening the Bluetooth remote sheet keeps the camera on under it (it was stopped and reopened)", async () => {
  const value = session({});
  const view = await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: /^Controle Bluetooth/ }),
  );
  expect(router.push).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: "/devices" }),
  );
  value.release.mockClear();
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(false); // the sheet covers the setup
  await view.rerender(<Setup />);
  expect(value.release).not.toHaveBeenCalled();
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(true);
});

test("the gesture tile toggles the gesture preference", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: /Acenar com os braços/ }),
  );
  expect(repo.setPrefs).toHaveBeenCalledWith(
    expect.objectContaining({
      modeSettings: expect.objectContaining({
        quadra: { gestureEnabled: false },
      }),
    }),
  );
});

test("Começar gravação starts the one mode and shows the recording controls on the same screen", async () => {
  const s = session({});
  const view = await render(<Setup />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Começar gravação" }),
  );
  expect(s.start).toHaveBeenCalledWith("quadra");

  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await view.rerender(<Setup />);
  expect(screen.getByText(/Toque na tela para salvar os últimos/)).toBeTruthy();
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
  expect(
    screen.getByRole("button", { name: "Começar gravação" }),
  ).toBeEnabled();
});

test("the button is disabled while the camera starts", async () => {
  session({ phase: "starting" });
  await render(<Setup />);
  expect(
    screen.getByRole("button", { name: "Começar gravação" }),
  ).toBeDisabled();
});

test("save feedback toggles: sound and flash", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
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
  await openSettings();
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
  await openSettings();
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
  await openSettings();
  expect(screen.getByLabelText("Voz, Indisponível neste celular")).toBeTruthy();
  expect(
    jest.requireMock("../../../modules/replay-camera").isVoiceSupported,
  ).toHaveBeenCalledWith("pt-BR");
});

test("Minhas gravações opens the game list, and is hidden during a game", async () => {
  session({});
  const view = await render(<Setup />);
  await fireEvent.press(
    screen.getByRole("button", { name: "Minhas gravações" }),
  );
  expect(router.push).toHaveBeenCalledWith("/games");

  session({ phase: "recording", sessionId: "s1", startedAt: Date.now() });
  await view.rerender(<Setup />);
  expect(screen.queryByRole("button", { name: "Minhas gravações" })).toBeNull();
});

test("voice on without speech permission shows Toque para permitir", async () => {
  repo.setPrefs({ modeSettings: { quadra: { voiceEnabled: true } } });
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("undetermined");
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByLabelText("Voz, Toque para permitir")).toBeTruthy();
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
  await openSettings();
  expect(screen.getByLabelText("Voz, Negado · libere em Ajustes")).toBeTruthy();
  jest
    .requireMock("../../../modules/replay-camera")
    .getSpeechPermission.mockReturnValue("granted");
});

test("opens collapsed: a summary and the start button, no modes to pick and nothing drawn over the camera", async () => {
  session({});
  await render(<Setup />);
  expect(screen.getByRole("button", { name: /^Ajustes: / })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Começar gravação" }),
  ).toBeEnabled();
  expect(screen.queryByText("MODO")).toBeNull();
  expect(screen.queryByRole("button", { name: "Academia" })).toBeNull();
  expect(
    screen.queryByTestId("guide-person", { includeHiddenElements: true }),
  ).toBeNull();
  expect(screen.queryByLabelText(/^Voz,/)).toBeNull();
});

test("the summary tells which triggers are on without opening", async () => {
  repo.setPrefs({
    modeSettings: { quadra: { voiceEnabled: true, gestureEnabled: false } },
  });
  session({});
  await render(<Setup />);
  expect(
    screen.getByRole("button", {
      name: "Ajustes: clipes de até 15 segundos, voz ligada, acenar com os braços desligado, controle não conectado",
    }),
  ).toBeTruthy();
});

test("the summary does not print the clip length: it is in the settings and in the spoken summary", async () => {
  session({});
  await render(<Setup />);
  expect(screen.queryByText(/Clipes de até/)).toBeNull();
});

test("the clip length options sit in the settings, with 15s picked by default (the free length)", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByText("TAMANHO DO CLIPE")).toBeTruthy();
  for (const label of ["15s", "30s", "45s", "60s"])
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
  expect(screen.getByRole("button", { name: "30s" })).not.toBeSelected();
});

test("picking a clip length saves it for the next recordings", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(screen.getByRole("button", { name: "45s" }));
  expect(repo.setPrefs).toHaveBeenCalledWith({
    modeSettings: { quadra: { cutSeconds: 45 } },
  });
  expect(screen.getByRole("button", { name: "45s" })).toBeSelected();
  expect(screen.getByRole("button", { name: "30s" })).not.toBeSelected();
});

test("the clip length picked before is the one selected when the screen opens", async () => {
  repo.setPrefs({ modeSettings: { quadra: { cutSeconds: 15 } } });
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
});

test("a remote press while collapsed shows the remote works", async () => {
  session({});
  await render(<Setup />);
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  const onPress = useVolumeRemote.mock.calls.at(-1)[1];
  const { act } = jest.requireActual("@testing-library/react-native");
  await act(() => onPress());
  expect(
    screen.getByRole("button", { name: /controle conectado$/ }),
  ).toBeTruthy();
});

test("a remote used in an earlier launch is not shown on until a press: it may have been unpaired since", async () => {
  const { StyleSheet } = jest.requireActual("react-native");
  const { colors } = jest.requireActual("../../theme/tokens");
  const statusColor = () =>
    StyleSheet.flatten(
      screen.getByText("Aperte um botão para conferir").props.style,
    ).color;

  session({});
  repo.setPrefs({ remoteTestedAt: 1 });
  await render(<Setup />);
  expect(
    screen.getByRole("button", { name: /controle a conferir$/ }),
  ).toBeTruthy();
  await openSettings();
  expect(statusColor()).not.toBe(colors.accent);
});

test("the positioning guide fits the camera area above the sheet", async () => {
  session({});
  await render(<Setup />);
  await fireEvent(screen.getByTestId("setup-sheet"), "layout", {
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
  ["unsupported", "Sem Apple Watch pareado"],
  ["notInstalled", "Instale o app no Apple Watch"],
  ["ready", "Pronto"],
])('the Apple Watch tile says %s as "%s"', async (status, text) => {
  camera().getWatchStatus.mockReturnValue(status);
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByLabelText(`Apple Watch, ${text}`)).toBeTruthy();
});

test("a watch status event updates the tile", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(
    screen.getByLabelText("Apple Watch, Sem Apple Watch pareado"),
  ).toBeTruthy();
  const listener = camera().addReplayListener.mock.calls.find(
    (c: any[]) => c[0] === "onWatchStatus",
  )[1];
  camera().getWatchStatus.mockReturnValue("ready");
  await act(async () => listener({ status: "ready" }));
  expect(screen.getByLabelText("Apple Watch, Pronto")).toBeTruthy();
});

test("the collapsed summary mentions a ready watch, and only then", async () => {
  session({});
  const view = await render(<Setup />);
  expect(
    screen.getByRole("button", { name: /^Ajustes:/ }).props.accessibilityLabel,
  ).not.toMatch(/Apple Watch pronto/);
  const listener = camera().addReplayListener.mock.calls.find(
    (c: any[]) => c[0] === "onWatchStatus",
  )[1];
  camera().getWatchStatus.mockReturnValue("ready");
  await act(async () => listener({ status: "ready" }));
  expect(
    screen.getByRole("button", { name: /Apple Watch pronto$/ }),
  ).toBeTruthy();
  view.unmount();
});

// ---- The watch trigger is paid (Pro, or a game already paid with the Pass)

function freeTier() {
  jest.requireMock("../../share/entitlement").usePlan.mockReturnValue("free");
}

// ---- Video quality (Full HD / 4K) and battery saving

test("4K is offered on a phone that has it, and picking it is saved for the mode and shown in the summary", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByText("QUALIDADE DO VÍDEO")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Full HD" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  await fireEvent.press(screen.getByRole("button", { name: "4K" }));
  expect(repo.setPrefs).toHaveBeenLastCalledWith({
    modeSettings: { quadra: { quality: "2160p30" } },
  });
  expect(
    screen.getByRole("button", { name: "4K" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(screen.getByText(/4K a 30 quadros por segundo/)).toBeTruthy();
  // Closed again, the summary says so.
  await fireEvent.press(screen.getByRole("button", { name: "Fechar ajustes" }));
  expect(screen.getByRole("button", { name: /em 4K/ })).toBeTruthy();
});

test("a phone without 4K shows no quality choice", async () => {
  camera().supportsQuality.mockReturnValue(false);
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.queryByText("QUALIDADE DO VÍDEO")).toBeNull();
  camera().supportsQuality.mockReturnValue(true);
});

test("on the free tier 4K carries the Pro badge, opens the paywall and the game stays in Full HD", async () => {
  freeTier();
  repo.setPrefs({ modeSettings: { quadra: { quality: "2160p30" } } });
  session({});
  await render(<Setup />);
  await openSettings();
  expect(
    screen.getByRole("button", { name: "Full HD" }).props.accessibilityState,
  ).toMatchObject({ selected: true });
  await fireEvent.press(
    screen.getByRole("button", { name: "4K, Disponível no PRO" }),
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

test("battery saving sits beside the zoom: on by default, a tap turns it off and says what that means", async () => {
  session({});
  await render(<Setup />);
  const button = screen.getByRole("switch", { name: "Economia de bateria" });
  expect(button.props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.queryByTestId("economy-toast")).toBeNull();
  jest.useFakeTimers();
  await fireEvent.press(button);
  expect(repo.setPrefs).toHaveBeenLastCalledWith({ screenEconomy: false });
  expect(
    screen.getByRole("switch", { name: "Economia de bateria" }).props
      .accessibilityState,
  ).toMatchObject({ checked: false });
  expect(screen.getByText("Economia de bateria desligada")).toBeTruthy();
  expect(
    screen.getByText("A tela fica acesa durante a gravação."),
  ).toBeTruthy();
  // On again, the notice says so; then it goes away by itself.
  await fireEvent.press(
    screen.getByRole("switch", { name: "Economia de bateria" }),
  );
  expect(screen.getByText("Economia de bateria ligada")).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(3000));
  expect(screen.queryByTestId("economy-toast")).toBeNull();
  jest.useRealTimers();
});

test("the settings sheet no longer has its own battery row", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.queryByText("BATERIA")).toBeNull();
});

test.each([
  ["unsupported", "Sem Apple Watch pareado", /Pareie um Apple Watch/],
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
    await openSettings();
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
  await openSettings();
  expect(screen.getByLabelText("Apple Watch, Pronto")).toBeTruthy();
});

test("on the free tier the Apple Watch tile shows a Pro badge and opens the paywall", async () => {
  freeTier();
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getAllByText("PRO").length).toBeGreaterThan(0);
  const tile = screen.getByRole("button", {
    name: "Apple Watch, Pronto, Disponível no PRO",
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
  await openSettings(); // 15s by default; the longer lengths are Pro
  expect(screen.getByRole("button", { name: "15s" })).toBeSelected();
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
  await openSettings();
  await fireEvent.press(screen.getByRole("button", { name: "15s" }));
  expect(openPaywall).not.toHaveBeenCalled();
  expect(repo.setPrefs).toHaveBeenCalledWith({
    modeSettings: { quadra: { cutSeconds: 15 } },
  });
});

test("on the free tier the phone remote tiles are free: they open their screens, not the paywall", async () => {
  freeTier();
  camera().isRemoteSupported.mockReturnValue(true);
  session({});
  await render(<Setup />);
  await openSettings();
  for (const title of [
    "Conectar um celular controle",
    "Usar este celular como controle",
  ]) {
    router.push.mockClear?.();
    await fireEvent.press(
      screen.getByRole("button", { name: new RegExp(`^${title}`) }),
    );
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", {
        name: new RegExp(`^${title}.*Disponível no PRO$`),
      }),
    ).toBeNull();
  }
  expect(openPaywall).not.toHaveBeenCalled();
});

test("on the free tier the Bluetooth remote tile is free: no lock, it opens the remote sheet", async () => {
  freeTier();
  camera().isRemoteSupported.mockReturnValue(true);
  session({});
  await render(<Setup />);
  await openSettings();
  router.push.mockClear?.();
  expect(
    screen.queryByRole("button", {
      name: /^Controle Bluetooth.*Disponível no PRO$/,
    }),
  ).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: /^Controle Bluetooth/ }),
  );
  expect(openPaywall).not.toHaveBeenCalled();
  expect(router.push).toHaveBeenCalledWith({
    pathname: "/devices",
    params: { kind: "remote" },
  });
});

test("on the free tier a locked watch is not counted as ready in the summary", async () => {
  freeTier();
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  expect(
    screen.getByRole("button", { name: /^Ajustes:/ }).props.accessibilityLabel,
  ).not.toMatch(/Apple Watch pronto/);
});

test("on Pro the Apple Watch tile has no badge and no paywall", async () => {
  camera().getWatchStatus.mockReturnValue("ready");
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.queryByText("PRO")).toBeNull();
  expect(screen.getByLabelText("Apple Watch, Pronto")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Apple Watch/ })).toBeNull();
});

test("without a watch the other triggers behave as before", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.getByLabelText("Acenar com os braços, Ativo")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Começar gravação" }),
  ).toBeEnabled();
});

// ---- Second iPhone as a remote ("Celular" tile)

function enableRemote(peers: { id: string; name: string }[]) {
  camera().isRemoteSupported.mockReturnValue(true);
  camera().remoteHostPeers.mockReturnValue(peers);
}

test("the Celular tile is hidden where the phone remote is not supported", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(screen.queryByLabelText(/^Conectar um celular controle/)).toBeNull();
  expect(camera().remoteHostStart).not.toHaveBeenCalled();
});

test('"Conectar um celular controle" opens the pairing sheet', async () => {
  enableRemote([]);
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: "Conectar um celular controle" }),
  );
  expect(router.push).toHaveBeenCalledWith("/pairing");
});

test("the setup screen does not start or stop the host: it lives as long as the app is open (root layout)", async () => {
  enableRemote([{ id: "a", name: "iPhone da Ana" }]);
  session({});
  const view = await render(<Setup />);
  await view.unmount();
  expect(camera().remoteHostStart).not.toHaveBeenCalled();
  expect(camera().remoteHostStop).not.toHaveBeenCalled();
});

test("the entry to the remote is offered only where the phone remote is supported", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  expect(
    screen.queryByLabelText(/^Usar este celular como controle/),
  ).toBeNull();
});

test('"Usar este celular como controle" opens the remote screen', async () => {
  enableRemote([]);
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: "Usar este celular como controle" }),
  );
  expect(router.push).toHaveBeenCalledWith("/remote");
});

test("a phone already paired as a remote says which camera phone it is paired with, under the title", async () => {
  session({});
  camera().isRemoteSupported.mockReturnValue(true);
  camera().remoteControllerHost.mockReturnValue({
    id: "h1",
    name: "iPhone XR#1234",
  });
  await render(<Setup />);
  await openSettings();
  expect(
    screen.getByRole("button", {
      name: "Usar este celular como controle, Pareado com iPhone XR#1234",
    }),
  ).toBeTruthy();
  expect(screen.getByText("Pareado com iPhone XR#1234")).toBeTruthy();
});

test("with nobody paired neither phone tile has a subtitle", async () => {
  enableRemote([]);
  camera().remoteControllerHost.mockReturnValue(null);
  camera().remoteHostControllers.mockReturnValue(0);
  session({});
  await render(<Setup />);
  await openSettings();
  expect(
    screen.getByRole("button", { name: "Conectar um celular controle" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Usar este celular como controle" }),
  ).toBeTruthy();
});

test('"Conectar um celular controle" says how many remotes are connected, and the title stays neutral', async () => {
  enableRemote([{ id: "a", name: "iPhone da Ana" }]);
  camera().remoteHostControllers.mockReturnValue(1);
  session({});
  await render(<Setup />);
  await openSettings();
  expect(
    screen.getByRole("button", {
      name: "Conectar um celular controle, 1 controle conectado",
    }),
  ).toBeTruthy();
  const title = screen.getByText("Conectar um celular controle");
  expect(JSON.stringify(title.props.style)).not.toContain("#D6F23F");
  // The count follows the link.
  const listener = camera()
    .addReplayListener.mock.calls.filter(
      (c: any[]) => c[0] === "onRemoteStatus",
    )
    .map((c: any[]) => c[1]);
  await act(async () =>
    listener.forEach((l: any) => l({ link: "connected", controllers: 2 })),
  );
  expect(
    screen.getByRole("button", {
      name: "Conectar um celular controle, 2 controles conectados",
    }),
  ).toBeTruthy();
  // This phone's own remote side (when it is used as a remote) says nothing about its remotes.
  await act(async () =>
    listener.forEach((l: any) => l({ side: "remote", link: "searching" })),
  );
  expect(
    screen.getByRole("button", {
      name: "Conectar um celular controle, 2 controles conectados",
    }),
  ).toBeTruthy();
  await act(async () =>
    listener.forEach((l: any) =>
      l({ side: "camera", link: "searching", controllers: 0 }),
    ),
  );
  expect(
    screen.getByRole("button", { name: "Conectar um celular controle" }),
  ).toBeTruthy();
});

test('"Desconectar deste celular" asks first, then forgets the camera phone and goes back to the first state', async () => {
  session({});
  camera().isRemoteSupported.mockReturnValue(true);
  camera().remoteControllerHost.mockReturnValue({
    id: "h1",
    name: "iPhone XR#1234",
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", { name: "Desconectar deste celular" }),
  );
  expect(camera().remoteControllerForget).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0][2] as {
    text: string;
    onPress?: () => void;
  }[];
  await act(async () => buttons.find((b) => b.text === "Esquecer")!.onPress!());
  expect(camera().remoteControllerForget).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Usar este celular como controle" }),
  ).toBeTruthy();
  alert.mockRestore();
});

test('the Bluetooth remote tile starts as "Toque para conectar" and opens the Dispositivos sheet on the remote', async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Controle Bluetooth, Toque para conectar",
    }),
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
  await openSettings();
  expect(
    screen.getByRole("button", {
      name: "Controle Bluetooth, Aperte um botão para conferir",
    }),
  ).toBeTruthy();
  const { useVolumeRemote } = jest.requireMock(
    "../../triggers/useVolumeRemote",
  );
  await act(async () => useVolumeRemote.mock.calls.at(-1)[1]());
  expect(
    screen.getByRole("button", { name: "Controle Bluetooth, Conectado" }),
  ).toBeTruthy();
});

test("a press heard in the Dispositivos sheet shows on the tile when coming back", async () => {
  session({});
  await render(<Setup />);
  await openSettings();
  await act(async () => require("../../devices/remoteTest").markRemotePress());
  expect(
    screen.getByRole("button", { name: "Controle Bluetooth, Conectado" }),
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
  expect(useVolumeRemote).toHaveBeenLastCalledWith(false, expect.any(Function));
  await act(async () => setRemoteSheetOpen(true));
  expect(useVolumeRemote).toHaveBeenLastCalledWith(true, expect.any(Function));
  expect(s.prepare).toHaveBeenCalled();
  await act(async () => setRemoteSheetOpen(false));
  expect(useVolumeRemote).toHaveBeenLastCalledWith(false, expect.any(Function));
  jest.requireMock("expo-router").useIsFocused.mockReturnValue(true);
});

test("no status line about the plan: neither a free count nor a Pass", async () => {
  session({});
  await render(<Setup />);
  expect(screen.queryByText(/Passe/)).toBeNull();
  expect(screen.queryByText(/grátis/)).toBeNull();
});

const pressStart = () =>
  fireEvent.press(screen.getByRole("button", { name: "Começar gravação" }));

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

describe("phone held on its side", () => {
  beforeEach(() =>
    jest
      .requireMock("../../../modules/replay-camera")
      .getDeviceUpright.mockReturnValue("landscapeLeft"),
  );

  test("the sheet gives way to two small buttons and the guide takes the whole screen", async () => {
    session({});
    await render(<Setup />);
    expect(screen.queryByTestId("setup-sheet")).toBeNull();
    expect(screen.getByRole("button", { name: "Gravar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ajustes" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Começar gravação" }),
    ).toBeNull();
  });

  test("Gravar starts the game with the mode", async () => {
    const s = session({});
    await render(<Setup />);
    await fireEvent.press(screen.getByRole("button", { name: "Gravar" }));
    expect(s.start).toHaveBeenCalledWith("quadra");
  });

  test("Ajustes opens the full settings over the camera, and closing them brings the small buttons back", async () => {
    session({});
    await render(<Setup />);
    await fireEvent.press(screen.getByRole("button", { name: "Ajustes" }));
    expect(screen.getByTestId("setup-sheet")).toBeTruthy();
    expect(screen.getByText("TAMANHO DO CLIPE")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Fechar ajustes" }),
    );
    expect(screen.getByRole("button", { name: "Gravar" })).toBeTruthy();
  });

  test("Gravar waits while the camera opens", async () => {
    session({ camera: "starting" });
    await render(<Setup />);
    expect(screen.getByRole("button", { name: "Gravar" })).toBeDisabled();
  });
});

test("held upright the setup sheet stays as it was", async () => {
  session({});
  await render(<Setup />);
  expect(screen.getByTestId("setup-sheet")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Gravar" })).toBeNull();
});

test("coming back from another app, a remote shown as connected goes back to paired until it is pressed again", async () => {
  const { markRemotePress } = require("../../devices/remoteTest");
  const listeners: ((s: string) => void)[] = [];
  const spy = jest
    .spyOn(require("react-native").AppState, "addEventListener")
    .mockImplementation(((_: string, fn: (s: string) => void) => {
      listeners.push(fn);
      return { remove: jest.fn() };
    }) as never);
  session({});
  await render(<Setup />);
  await act(async () => markRemotePress());
  expect(require("../../devices/remoteTest").hasRemotePress()).toBe(true);
  await act(async () => listeners.forEach((fn) => fn("active")));
  expect(require("../../devices/remoteTest").hasRemotePress()).toBe(false);
  spy.mockRestore();
});
