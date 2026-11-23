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
  CloseIcon,
  DownloadIcon,
  FilmIcon,
  MoreIcon,
} from "../../components/icons";
import { clipNumber, sessionLabel } from "../../components/format";
import { receiveQueue, useReceiveProgress } from "../../cloud/receive";
import { removeReceivedFiles } from "../../cloud/receivedPaths";
import { confirmClipsShare, confirmShare } from "../../cloud/shareConfirm";
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
import { GlassButton } from "../../components/GlassButton";

export default function SessionSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { reset, state } = useSession();
  const { t, locale } = useT();
  const navigation = useNavigation();
  // Re-read whenever the repo changes (a clip deleted on the clip screen, a late save landing).
  const version = useSyncExternalStore(repo.subscribe, repo.version);
  const live = useMemo(
    () => ({
      session: repo.getSession(id),
      clips: repo.listClips(id),
      stats: repo.sessionStats(id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [id, version],
  );
  // Deleting the recording from its own "…" (2026-11-22): the screen keeps showing it as it was while it goes back to
  // Minhas gravações (it flashed "Nenhum lance salvo" for a moment, its clips already gone).
  const [deleted, setDeleted] = useState<typeof live>();
  const { session, clips, stats } = deleted ?? live;

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
    // Asked first (2026-11-22): what goes in the link and for how long; a link that exists opens straight away.
    if (!session) return;
    confirmShare(t, [session], clips.length, () => router.push(`/share/${id}`));
  }

  // A link with only the picked clips (2026-11-23): one live link per recording, so a live one is shown, not doubled.
  async function sharePicked() {
    if (!shareAllowed) {
      track("pro_feature_blocked", { feature: "share" });
      const outcome = await openPaywall(t, "locked_feature");
      if (outcome !== "purchased" && outcome !== "restored") return;
    }
    if (!session || pickedClips.length === 0) return;
    const ids = pickedClips.map((c) => c.id).join(",");
    confirmClipsShare(
      t,
      session,
      sessionLabel(session, undefined, locale),
      pickedClips.length,
      () => {
        stopSelecting();
        router.push(`/share/${id}?clips=${ids}`);
      },
      () => {
        stopSelecting();
        router.push(`/share/${id}`);
      },
    );
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
  // A tap on the name puts the cursor after it, nothing selected, so typing adds to it, as on the clip screen
  // (2026-11-22: the whole name was selected and the first key replaced it). Released at once, so the cursor moves freely.
  const [atEnd, setAtEnd] = useState<{ start: number; end: number }>();
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
            setDeleted(live);
            const sharedWithMe = session && session.received ? session.received.shareId : undefined;
            repo.deleteSession(id).forEach((path) => removeFile(path));
            if (sharedWithMe !== undefined) removeReceivedFiles(sharedWithMe);
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
    // Cancelar on a received recording took its clips off the phone: the recording stays, ready to download again.
    if (session.received && session.received.download === "waiting") return;
    repo.deleteSession(id).forEach((path) => removeFile(path));
    if (state.sessionId === id) reset();
    leaveToGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the clip list changes
  }, [clips.length, session]);

  // A received recording on screen: its link is asked about (the person's own tap: a link turned off is learnt here),
  // and it is never removed from under the person while open (2026-11-22).
  const isReceived = session !== undefined && session.received !== undefined;
  useEffect(() => {
    if (!isReceived) return;
    return receiveQueue.opened(id);
  }, [id, isReceived]);

  const { width: screenWidth } = useWindowDimensions();
  const tileWidth = Math.floor((screenWidth - 4) / 3);
  // A received recording: the clips still on their way take their place in the grid.
  const receive = useReceiveProgress(
    session && session.received ? id : undefined,
  );
  type Tile =
    | { kind: "clip"; key: string; clip: Clip; number: number }
    | { kind: "pending"; key: string; number: number; downloading: boolean; thumb?: string };
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
        thumb: receive.thumbs === undefined ? undefined : receive.thumbs[place.position],
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
    // Compartilhar sits here now (2026-11-22), not floating over the clips.
    const share = canShareHere
      ? {
          text: shareAllowed ? t("summary.shareButton") : `${t("summary.shareButton")} (${t("summary.proBadge")})`,
          run: () => void startShare(),
        }
      : undefined;
    const options = [
      ...(share ? [share] : []),
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
            <GlassButton
              accessibilityRole="button"
              accessibilityLabel={t("common.back")}
              onPress={goBack}
              style={styles.round}
            >
              <BackIcon />
            </GlassButton>
            <TextInput
              accessibilityLabel={t("summary.nameLabel")}
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveName}
              onFocus={() => setAtEnd({ start: name.length, end: name.length })}
              onSelectionChange={() => (atEnd !== undefined ? setAtEnd(undefined) : undefined)}
              selection={atEnd}
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
            {/* Selecting (2026-11-22, trying it): "Todos"/"Limpar" where "…" was, and an ✕ to stop where "Selecionar"
                was; the numbers under the name stay. */}
            {selecting ? (
              <GlassButton
                accessibilityRole="button"
                accessibilityLabel={
                  pickedClips.length === clips.length
                    ? t("summary.clearSelection")
                    : t("summary.selectAll")
                }
                onPress={pickAll}
                style={styles.pill}
              >
                {/* In the app's amber, as the link it was. */}
                <Text style={[styles.pillText, styles.pillTextAccent]}>
                  {pickedClips.length === clips.length
                    ? t("summary.clear")
                    : t("summary.all")}
                </Text>
              </GlassButton>
            ) : (
              <GlassButton
                accessibilityRole="button"
                accessibilityLabel={t("summary.more")}
                onPress={openMenu}
                style={[styles.round, styles.roundSmall]}
              >
                <MoreIcon />
              </GlassButton>
            )}
            {selecting ? (
              <GlassButton
                accessibilityRole="button"
                accessibilityLabel={t("summary.cancelSelection")}
                onPress={stopSelecting}
                style={[styles.round, styles.roundSmall]}
              >
                <CloseIcon size={18} />
              </GlassButton>
            ) : clips.length > 0 ? (
              <GlassButton
                accessibilityRole="button"
                accessibilityLabel={t("summary.selectClips")}
                onPress={() => setSelecting(true)}
                style={styles.pill}
              >
                <Text style={styles.pillText}>{t("summary.select")}</Text>
              </GlassButton>
            ) : null}
          </View>
        ) : null}

          <View style={styles.stats}>
            <Stat
              icon={<FilmIcon size={18} color={colors.accent} />}
              value={String(stats.clips)}
              label={t("summary.clipsStat", { count: stats.clips })}
            />
            {/* A received recording was not recorded on this phone: its minutes come with the link (2026-11-20); links
                made before that have none. */}
            {recordedMs === undefined ? null : (
              <Stat
                icon={<ClockIcon size={18} color={colors.accent} />}
                value={String(Math.floor(recordedMs / 60_000))}
                label={t("summary.minutesShort")}
              />
            )}
            <Stat
              icon={<DiskIcon size={18} color={colors.accent} />}
              value={new Intl.NumberFormat(locale).format(
                Math.round(stats.bytes / 1_000_000),
              )}
              label={t("summary.megabytesShort")}
            />
          </View>

        {/* A received recording: who sent it and how far the download is (the free unlock is offered on Salvar). */}
        {SHARING_ENABLED && session && session.received ? (
          <ReceivedBanner sessionId={id} received={session.received} onDelete={confirmDeleteGame} />
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
        extraData={[selecting, picked, plan, tileWidth, receive]}
        renderItem={({ item }) =>
          item.kind === "pending" ? (
            <PendingClipTile
              number={item.number}
              width={tileWidth}
              downloading={item.downloading}
              thumb={item.thumb}
              idle={receive.download !== "on"}
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
            onLink={canShareHere ? () => void sharePicked() : undefined}
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
      ) : received && clips.length > 0 ? (
        // Compartilhar left the clips for the "…" menu (2026-11-22); a received recording keeps Salvar clipes here.
        <SafeAreaView edges={["bottom"]} style={styles.floating} pointerEvents="box-none">
          <Capsule
            label={t("summary.saveAll")}
            icon={<DownloadIcon size={19} color={colors.onAccent} />}
            disabled={working}
            onPress={() => void exportAfterNotice("save", clips, batch.save)}
          />
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
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  // Closer to the name above and the card below than the screen's other gaps (2026-11-22): 5 instead of 12.
  stats: { flexDirection: "row", gap: 6, marginVertical: -7 },
  // Equal cells, each one's icon, number and unit centred in it: the columns line up whatever the numbers (2026-11-20).
  stat: {
    flex: 1,
    minWidth: 0,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  // A little larger (2026-11-22): the recording's numbers at a glance.
  statValue: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  statLabel: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
  },
  grid: { gap: 2, paddingBottom: 110 },
  gridRow: { gap: 2 },
  empty: { paddingHorizontal: 20 },
  footer: {
    paddingHorizontal: footer.side - 4,
    paddingTop: 6,
    paddingBottom: footer.bottom,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
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
  // As tall as the numbers' row it takes the place of, "Todos" centred in it: the list does not move (2026-11-22).
  pickBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    marginVertical: -7,
  },
  pickLink: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.accent },
  pillTextAccent: { color: colors.accent },
  pickCount: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
});
