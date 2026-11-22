import { router, useLocalSearchParams, useNavigation } from "expo-router";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { isFocusSupported } from "../../../modules/replay-camera";
import { BatchResultCard } from "../../components/BatchResultCard";
import { ClipCard, PendingClipTile } from "../../components/ClipCard";
import { LabelSheet } from "../../components/LabelSheet";
import { EmptyState } from "../../components/EmptyState";
import { ExportProgress } from "../../components/ExportProgress";
import { SelectionBar } from "../../components/SelectionBar";
import { ShareStrip } from "../../components/ShareStrip";
import { ReceivedBanner } from "../../components/ReceivedBanner";
import { ReportSheet } from "../../components/ReportSheet";
import { UpgradeCard } from "../../components/UpgradeCard";
import {
  BackIcon,
  ClipIcon,
  ClockIcon,
  DiskIcon,
  DownloadIcon,
  FilmIcon,
  LockIcon,
  MoreIcon,
  ShareIcon,
} from "../../components/icons";
import { clipNumber, sessionLabel } from "../../components/format";
import { useReceiveProgress } from "../../cloud/receive";
import { markOpened } from "../../data/lastOpened";
import { removeFile, repo } from "../../data/mmkv";
import { MAX_GAME_NAME, type Clip } from "../../data/schema";
import { accessPlan } from "../../payments/rules";
import { canShare } from "../../payments/limits";
import { openPaywall } from "../../payments/feedback";
import { track } from "../../analytics";
import { SHARING_ENABLED } from "../../account/flags";
import { useCourtesyGate } from "../../components/useCourtesyGate";
import { useFreeExportGate } from "../../components/useFreeExportGate";
import {
  exportTierOf,
  useProActive,
  useReceivedAccess,
  useViewPlan,
} from "../../share/entitlement";
import { freeLosses } from "../../share/exportOptions";
import { useBatchActions } from "../../share/useBatchActions";
import { useT } from "../../i18n/useT";
import { useSession } from "../../session/SessionContext";
import { colors, fonts, footer } from "../../theme/tokens";

export default function SessionSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reset, state } = useSession();
  const { t, locale } = useT();
  const navigation = useNavigation();
  // Re-read whenever the repo changes (a clip deleted on the clip screen, a late save landing).
  const version = useSyncExternalStore(repo.subscribe, repo.version);
  const { session, clips, stats } = useMemo(
    () => ({
      session: repo.getSession(id),
      clips: repo.listClips(id),
      stats: repo.sessionStats(id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [id, version],
  );

  const plan = useViewPlan(id);
  // A received recording (sharing §2.8–10): Pro as one's own, else Full HD with the mark after a courtesy.
  const access = useReceivedAccess(id);
  // Sharing follows the subscription, not the recording: a Single Pass does not share (sharing design, decision 2).
  const shareAllowed = canShare(useProActive() ? "paid" : "free");
  // The clock for the link's time left, read again every minute.
  const [shareNow, setShareNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setShareNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  async function startShare() {
    if (!shareAllowed) {
      track("pro_feature_blocked", { feature: "share" });
      const outcome = await openPaywall(t, "locked_feature");
      if (outcome !== "purchased" && outcome !== "restored") return;
    }
    router.push(`/share/${id}`);
  }

  // Jogadores and Bola are analysed only when the player picks them on a clip (2026-11-11): nothing runs from this list.
  // Minhas gravações marks the recording seen last; set before the first paint, so the list is right on the way back.
  useLayoutEffect(() => markOpened(id), [id]);

  // The label (etiqueta) of the picked clips: the sheet, with the labels already used in this recording (newest first).
  const [labelling, setLabelling] = useState<string[]>();
  const labelled =
    labelling === undefined
      ? undefined
      : clips.filter((c) => labelling.includes(c.id));
  const usedLabels = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...clips].sort((a, b) => b.createdAt - a.createdAt)) {
      if (!c.name || seen.has(c.name.toLowerCase())) continue;
      seen.add(c.name.toLowerCase());
      out.push(c.name);
    }
    return out.slice(0, 8);
  }, [clips]);
  // The sheet opens with their label when they all have the same one.
  const labelledName =
    labelled !== undefined &&
    labelled.length > 0 &&
    labelled.every((c) => (c.name ?? "") === (labelled[0].name ?? ""))
      ? (labelled[0].name ?? "")
      : "";
  const finishLabel = (label: string) => {
    for (const clip of labelled ?? []) {
      if (label.trim() !== (clip.name ?? "")) repo.renameClip(clip.id, label);
    }
    setLabelling(undefined);
    stopSelecting();
  };

  const [name, setName] = useState(() => session?.name ?? "");
  // A name typed and left without Enter (Voltar, a swipe back) is kept as well: saved when the screen goes.
  const typedName = useRef(name);
  useEffect(() => {
    typedName.current = name;
  }, [name]);
  useEffect(
    () => () => {
      const saved = repo.getSession(id);
      if (saved && typedName.current.trim() !== (saved.name ?? ""))
        repo.renameSession(id, typedName.current);
    },
    [id],
  );
  const saveName = () => {
    if (session && name.trim() !== (session.name ?? ""))
      repo.renameSession(id, name);
  };

  // Picking clips to delete.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  // A picked clip deleted elsewhere (the clip screen) is no longer in the list: only what is still there counts.
  const pickedClips = useMemo(
    () => clips.filter((c) => picked.includes(c.id)),
    [clips, picked],
  );
  const batch = useBatchActions({
    plan,
    tier: exportTierOf(plan, access),
    labelOf: (c) =>
      c.name
        ? c.name
        : t("batch.clipNumber", { number: clipNumber(c, clips.indexOf(c)) }),
  });
  const working = batch.job !== undefined;
  // A free recording's clips leave in HD, without sound and Modo Foco, with the app mark: say so before saving or sending
  // them (the full notice on the recording's first export; later ones go on). The PRO card opens the same sheet.
  const freeGate = useFreeExportGate();
  const courtesyGate = useCourtesyGate();
  // Denunciar on a received recording (sharing §8.3).
  const [reporting, setReporting] = useState(false);
  const exportAfterNotice = async (
    kind: "save" | "share",
    clips: typeof pickedClips,
    go: (clips: typeof pickedClips) => Promise<void>,
  ) => {
    // A received recording without Pro leaves only with a courtesy (spent once, on its first Save or Send).
    if (access === "locked" && !(await courtesyGate.ask(id))) return;
    // Nothing is lost while the field test unlocks it all (accessPlan): no notice then.
    if (access === undefined && accessPlan(plan) === "free") {
      const proceed = await freeGate.ask(
        id,
        {
          focus: clips.some((c) => freeLosses(c).focus),
          sound: clips.some((c) => freeLosses(c).sound),
        },
        kind,
        {
          preview:
            clips.length > 0
              ? { path: clips[0].path, atMs: clips[0].trim.startMs }
              : undefined,
          many: clips.length > 1,
        },
      );
      if (!proceed) return;
    }
    await go(clips);
  };
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };
  const toggle = (clipId: string) =>
    setPicked((current) =>
      current.includes(clipId)
        ? current.filter((c) => c !== clipId)
        : [...current, clipId],
    );
  const pickAll = () =>
    setPicked(
      pickedClips.length === clips.length ? [] : clips.map((c) => c.id),
    );

  function confirmDeleteClips() {
    const count = pickedClips.length;
    Alert.alert(
      t("summary.deleteClipsTitle", { count }),
      t("common.cantUndo"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            for (const clip of pickedClips) {
              removeFile(clip.path);
              repo.deleteClip(clip.id);
            }
            stopSelecting();
          },
        },
      ],
    );
  }

  function confirmDeleteGame() {
    const count = clips.length;
    Alert.alert(
      t("summary.deleteGameTitle"),
      count === 0
        ? t("summary.deleteGameEmpty")
        : t("summary.deleteGameBody", { count }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            repo.deleteSession(id).forEach((path) => removeFile(path));
            if (state.sessionId === id) reset();
            leaveToGames();
          },
        },
      ],
    );
  }

  // Minhas gravações must always have the setup screen under it. A game that has just ended got here straight from the
  // setup, so /games is not in the stack and dismissTo would leave it as the only screen, with nowhere to go back to.
  function leaveToGames() {
    const state = navigation.getState();
    const inStack =
      state === undefined ||
      state.routes.some((route) => route.name === "games");
    if (inStack) {
      router.dismissTo("/games");
      return;
    }
    router.dismissTo("/setup");
    router.push("/games");
  }

  // However this screen goes (swiping back to the setup, Android's back, Nova gravação, Minhas gravações), the game that
  // has just ended leaves with it: the setup under it starts over, as Nova gravação always did.
  const leaving = useRef({ live: state.sessionId === id, reset });
  useEffect(() => {
    leaving.current = { live: state.sessionId === id, reset };
  }, [state.sessionId, id, reset]);
  useEffect(
    () => () => {
      if (leaving.current.live) leaving.current.reset();
    },
    [],
  );

  function newGame() {
    // Only the game that just ended resets the live session; from Minhas gravações, setup is already under us.
    if (state.sessionId === id) reset();
    router.dismissTo("/setup");
  }

  // A game whose last clip was just deleted (here or on the clip screen) has nothing left to show: remove it too and go
  // back to the list. A game that was recorded without any clip still opens as an empty summary.
  const hadClips = useRef(clips.length > 0);
  useEffect(() => {
    if (clips.length > 0) {
      hadClips.current = true;
      return;
    }
    if (!hadClips.current || !session) return;
    hadClips.current = false;
    repo.deleteSession(id).forEach((path) => removeFile(path));
    if (state.sessionId === id) reset();
    leaveToGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the clip list changes
  }, [clips.length, session]);

  const { width: screenWidth } = useWindowDimensions();
  const tileWidth = Math.floor((screenWidth - 4) / 3);
  // A received recording: the clips still on their way take their place in the grid.
  const receive = useReceiveProgress(
    session && session.received ? id : undefined,
  );
  type Tile =
    | { kind: "clip"; key: string; clip: Clip; number: number }
    | { kind: "pending"; key: string; number: number; downloading: boolean };
  const ownTiles = (): Tile[] =>
    clips.map((clip, index) => ({ kind: "clip", key: clip.id, clip, number: clipNumber(clip, index) }));
  /**
   * A received recording keeps one place per clip of the share, in the sender's order, keyed by that place
   * (2026-11-21): a clip that arrives fills its own place, so nothing moves or blinks while the others download, and
   * the places still waiting show their real numbers.
   */
  const receivedTiles = (): Tile[] => {
    const slots = receive.slots || [];
    const running = receive.running || [];
    const byPosition = new Map<number, Clip>();
    for (const clip of clips) if (clip.sharePosition !== undefined) byPosition.set(clip.sharePosition, clip);
    const places =
      slots.length > 0
        ? slots
        : Array.from({ length: Math.max(receive.total, clips.length) }, (_, i) => ({ position: i + 1, number: i + 1 }));
    const out: Tile[] = places.map((place): Tile => {
      const clip = byPosition.get(place.position);
      if (clip !== undefined) {
        byPosition.delete(place.position);
        return { kind: "clip", key: `slot-${place.position}`, clip, number: clipNumber(clip, clips.indexOf(clip)) };
      }
      return {
        kind: "pending",
        key: `slot-${place.position}`,
        number: place.number,
        downloading: !receive.paused && running.includes(place.position),
      };
    });
    // A clip whose place is not in the list (an old share): after the others.
    for (const clip of clips)
      if (clip.sharePosition === undefined || byPosition.has(clip.sharePosition))
        out.push({ kind: "clip", key: clip.id, clip, number: clipNumber(clip, clips.indexOf(clip)) });
    return out;
  };
  const tiles: Tile[] = session && session.received ? receivedTiles() : ownTiles();

  const received = session !== undefined && session.received !== undefined;
  const recordedMs =
    session && session.received ? session.received.recordedMs : stats.recordedMs;
  const canShareHere =
    SHARING_ENABLED &&
    session !== undefined &&
    session.endedAt !== undefined &&
    !received &&
    clips.length > 0;

  function goBack() {
    // The recording that has just ended came straight from the setup: back there, starting over.
    if (state.sessionId === id) {
      newGame();
      return;
    }
    if (router.canGoBack()) router.back();
    else leaveToGames();
  }

  // ⋯: Denunciar (a received recording) and Apagar gravação.
  function openMenu() {
    const report =
      SHARING_ENABLED && received
        ? { text: t("report.link"), run: () => setReporting(true) }
        : undefined;
    const options = [
      ...(report ? [report] : []),
      { text: t("games.deleteRecording"), run: confirmDeleteGame },
    ];
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.text), t("common.cancel")],
          destructiveButtonIndex: options.length - 1,
          cancelButtonIndex: options.length,
          userInterfaceStyle: "dark",
        },
        (index) => {
          if (index < options.length) options[index].run();
        },
      );
      return;
    }
    Alert.alert(session ? sessionLabel(session, undefined, locale) : "", undefined, [
      ...options.map((o, i) => ({
        text: o.text,
        style: i === options.length - 1 ? ("destructive" as const) : ("default" as const),
        onPress: o.run,
      })),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.top}>
        {/* The name field, "Gravação · date, time" until the player names it, opens the screen (2026-11-02). */}
        {session ? (
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              onPress={goBack}
              style={styles.round}
            >
              <BackIcon />
            </Pressable>
            <TextInput
              accessibilityLabel={t("summary.nameLabel")}
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveName}
              onBlur={saveName}
              placeholder={sessionLabel(
                { ...session, name: undefined },
                undefined,
                locale,
              )}
              placeholderTextColor={colors.text}
              maxLength={MAX_GAME_NAME}
              returnKeyType="done"
              style={styles.nameInput}
            />
            {selecting ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("summary.more")}
                onPress={openMenu}
                style={[styles.round, styles.roundSmall]}
              >
                <MoreIcon />
              </Pressable>
            )}
            {clips.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  selecting ? t("summary.cancelSelection") : t("summary.selectClips")
                }
                onPress={() => (selecting ? stopSelecting() : setSelecting(true))}
                style={styles.pill}
              >
                <Text style={styles.pillText}>
                  {selecting ? t("common.cancel") : t("summary.select")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {selecting ? (
          <View style={styles.pickBar}>
            <Text style={styles.pickCount}>
              {pickedClips.length === 0
                ? t("summary.tapClips")
                : t("summary.selected", { count: pickedClips.length })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                pickedClips.length === clips.length
                  ? t("summary.clearSelection")
                  : t("summary.selectAll")
              }
              hitSlop={8}
              onPress={pickAll}
            >
              <Text style={styles.pickLink}>
                {pickedClips.length === clips.length
                  ? t("summary.clear")
                  : t("summary.all")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.stats}>
            <Stat
              icon={<FilmIcon size={15} color={colors.accent} />}
              value={String(stats.clips)}
              label={t("summary.clipsStat", { count: stats.clips })}
            />
            {/* A received recording was not recorded on this phone: its minutes come with the link (2026-11-20); links
                made before that have none. */}
            {recordedMs === undefined ? null : (
              <Stat
                icon={<ClockIcon size={15} color={colors.accent} />}
                value={String(Math.floor(recordedMs / 60_000))}
                label={t("summary.minutesShort")}
              />
            )}
            <Stat
              icon={<DiskIcon size={15} color={colors.accent} />}
              value={new Intl.NumberFormat(locale).format(
                Math.round(stats.bytes / 1_000_000),
              )}
              label={t("summary.megabytesShort")}
            />
          </View>
        )}

        {/* A received recording: who sent it and how far the download is (the free unlock is offered on Salvar). */}
        {SHARING_ENABLED && session && session.received ? (
          <ReceivedBanner sessionId={id} received={session.received} />
        ) : null}

        {/* A live link: where the upload is and how long it lasts; a tap opens the share sheet. */}
        {SHARING_ENABLED &&
        session &&
        session.shared &&
        session.shared.state === "active" &&
        session.shared.expiresAt > shareNow ? (
          <ShareStrip sessionId={id} shared={session.shared} now={shareNow} />
        ) : null}

        {/* The summary only exists after the recording ends, so this card never shows mid-recording. */}
        {/* A received recording gets the free unlock instead (sharing design §4), not this card. */}
        {plan === "free" && !received ? (
          <UpgradeCard
            title={t("summary.freeTitle")}
            message={t(
              isFocusSupported() ? "summary.freeNote" : "summary.freeNoteNoFocus",
            )}
            action={t("summary.upgrade")}
            badge={t("setup.proBadge")}
            onPress={() =>
              freeGate.offer(
                id,
                {
                  focus: clips.some((c) => freeLosses(c).focus),
                  sound: clips.some((c) => freeLosses(c).sound),
                },
                {
                  preview:
                    clips.length > 0
                      ? { path: clips[0].path, atMs: clips[0].trim.startMs }
                      : undefined,
                  many: clips.length > 1,
                },
              )
            }
          />
        ) : null}
      </View>

      <LabelSheet
        key={labelling === undefined ? "none" : labelling.join(",")}
        visible={labelled !== undefined}
        initial={labelledName}
        suggestions={usedLabels}
        onDone={finishLabel}
      />

      <FlatList
        // In the order they were saved, the first clip on top (Victor, 2026-11-13: back from newest first)
        data={tiles}
        keyExtractor={(item) => item.key}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.empty}>
            <EmptyState
              icon={<ClipIcon color={colors.accent} size={40} />}
              title={t("summary.emptyTitle")}
              message={t("summary.emptyMessage")}
            />
          </View>
        }
        extraData={[selecting, picked, plan, tileWidth]}
        renderItem={({ item }) =>
          item.kind === "pending" ? (
            <PendingClipTile
              number={item.number}
              width={tileWidth}
              downloading={item.downloading}
            />
          ) : (
            <ClipCard
              clip={item.clip}
              number={item.number}
              width={tileWidth}
              selecting={selecting}
              selected={picked.includes(item.clip.id)}
              onPress={() =>
                selecting
                  ? toggle(item.clip.id)
                  : router.push(`/clip/${item.clip.id}`)
              }
              onLongPress={
                selecting
                  ? undefined
                  : () => {
                      setSelecting(true);
                      setPicked([item.clip.id]);
                    }
              }
            />
          )
        }
      />

      {selecting ? (
        <SafeAreaView edges={["bottom"]} style={styles.footer}>
          <SelectionBar
            count={pickedClips.length}
            paid={plan === "paid"}
            busy={working}
            onShare={() =>
              void exportAfterNotice("share", pickedClips, batch.share)
            }
            onSave={() =>
              void exportAfterNotice("save", pickedClips, batch.save)
            }
            onCompile={() => void batch.compile(pickedClips)}
            onLabel={() => setLabelling(pickedClips.map((c) => c.id))}
            onDelete={confirmDeleteClips}
          />
        </SafeAreaView>
      ) : canShareHere || (received && clips.length > 0) ? (
        <SafeAreaView edges={["bottom"]} style={styles.floating} pointerEvents="box-none">
          {/* Only an ended recording is shared (decision 16): this screen is the summary of one. */}
          {canShareHere ? (
            <Capsule
              label={t("summary.shareButton")}
              icon={
                shareAllowed ? (
                  <ShareIcon size={19} color={colors.onAccent} />
                ) : (
                  <LockIcon size={14} color={colors.onAccent} />
                )
              }
              hint={shareAllowed ? undefined : t("sharing.locked")}
              onPress={() => void startShare()}
            />
          ) : (
            <Capsule
              label={t("summary.saveAll")}
              icon={<DownloadIcon size={19} color={colors.onAccent} />}
              disabled={working}
              onPress={() => void exportAfterNotice("save", clips, batch.save)}
            />
          )}
        </SafeAreaView>
      ) : null}
      {freeGate.sheet}
      {courtesyGate.sheet}
      <ReportSheet
        code={reporting && session && session.received ? session.received.code : null}
        onClose={() => setReporting(false)}
      />
      {batch.overlay}
      {batch.job ? (
        <ExportProgress
          job={batch.job}
          onCancel={batch.job.stage === "preparing" ? batch.cancel : undefined}
        />
      ) : null}
      {batch.card ? (
        <BatchResultCard card={batch.card} onClose={batch.closeCard} />
      ) : null}
    </SafeAreaView>
  );
}

/** The screen's one action, floating over the clips (Compartilhar, or Salvar clipes on a received recording). */
function Capsule({
  label,
  icon,
  onPress,
  hint,
  disabled = false,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.capsule,
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
      ]}
    >
      {icon}
      <Text style={styles.capsuleText}>{label}</Text>
    </Pressable>
  );
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: ReactNode;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      {icon}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  // The header, stats and banners keep a margin; the clips go edge to edge, as in Photos (2026-11-20).
  top: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  roundSmall: { width: 36, height: 36, borderRadius: 18 },
  nameInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    paddingHorizontal: 4,
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    color: colors.text,
  },
  pill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  stats: { flexDirection: "row", gap: 6 },
  // Equal cells, each one's icon, number and unit centred in it: the columns line up whatever the numbers (2026-11-20).
  stat: {
    flex: 1,
    minWidth: 0,
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  statValue: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  statLabel: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
  },
  grid: { gap: 2, paddingBottom: 110 },
  gridRow: { gap: 2 },
  empty: { paddingHorizontal: 20 },
  footer: { paddingHorizontal: footer.side, paddingTop: 8, paddingBottom: footer.bottom },
  // Where every screen's bottom button sits (Gravações' "Nova gravação", 2026-11-21).
  floating: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingBottom: footer.bottom,
  },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 52,
    paddingHorizontal: 26,
    borderRadius: 26,
    backgroundColor: colors.accent,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  capsuleText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.onAccent },
  pickBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 36,
  },
  pickLink: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  pickCount: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
});
