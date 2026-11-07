import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { requestPermissions } from "../../modules/replay-camera";
import { track } from "../analytics";
import { Button } from "../components/Button";
import { repo } from "../data/mmkv";
import { useT } from "../i18n/useT";
import { EditMedia } from "../onboarding/EditMedia";
import { Reveal } from "../onboarding/motion";
import { RecordMedia } from "../onboarding/RecordMedia";
import { SaveMedia } from "../onboarding/SaveMedia";
import { ShareMedia } from "../onboarding/ShareMedia";
import { slidesFor, splitHighlight, waysOf } from "../onboarding/slides";
import { StoryBars } from "../onboarding/StoryBars";
import { useStories } from "../onboarding/useStories";
import { colors, fonts, radius } from "../theme/tokens";

/** The stories on this platform (no Apple Watch slide outside iOS). */
const SLIDES = slidesFor(Platform.OS);

/** How long a finger must stay down to count as a hold (which freezes the story) and not as a tap. */
const HOLD_MS = 180;

/**
 * First run: the app's steps told as stories, the way Instagram plays them. A tap on the left edge goes back, on the
 * right goes forward, holding a finger down freezes the current step, and each one moves on by itself.
 *
 * The two tap areas sit behind the content, which lets touches through (`box-none`) except on what the player can use
 * (options, buttons), so a hold or a tap works anywhere else on the screen.
 */
export default function Onboarding() {
  const { t } = useT();
  const stories = useStories(SLIDES);
  const [denied, setDenied] = useState(false);

  const slide = SLIDES[stories.index];
  const step = (slide.step + 1) as 1 | 2 | 3 | 4;
  // One report per step: the second slide of a step, and going back to a step already seen, are not new views.
  const seenSteps = useRef(new Set<number>());
  useEffect(() => {
    if (seenSteps.current.has(step)) return;
    seenSteps.current.add(step);
    track("onboarding_step_viewed", { step });
  }, [step]);
  const last = stories.index === SLIDES.length - 1;
  // The Pro way to save has no supporting line: its card and the saved clip on the photo already say it all.
  const body = slide.id === "savePro" ? "" : t(`onboarding.${slide.id}.body`);
  const [before, highlighted, after] = splitHighlight(body);

  async function allow() {
    const granted = await requestPermissions();
    track("permission_result", { kind: "camera", granted });
    if (granted) {
      track("onboarding_completed");
      repo.setPrefs({ onboardingDone: true });
      router.replace("/setup");
    } else {
      setDenied(true);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.zones}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.previousStory")}
          delayLongPress={HOLD_MS}
          onPress={stories.previous}
          onLongPress={stories.hold}
          onPressOut={stories.release}
          style={styles.zoneBack}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("onboarding.nextStory")}
          delayLongPress={HOLD_MS}
          onPress={stories.next}
          onLongPress={stories.hold}
          onPressOut={stories.release}
          style={styles.zoneNext}
        />
      </View>

      <SafeAreaView style={styles.content} pointerEvents="box-none">
        <View style={styles.bars}>
          <StoryBars
            slides={SLIDES}
            index={stories.index}
            progress={stories.progress}
          />
        </View>

        <View style={styles.header} pointerEvents="box-none">
          {last ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                track("onboarding_skipped", { step });
                stories.goTo(SLIDES.length - 1);
              }}
              style={styles.skip}
            >
              <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
            </Pressable>
          )}
        </View>

        <Reveal key={slide.id} style={styles.copy}>
          <View pointerEvents="none">
            <View style={styles.headline}>
              <Text allowFontScaling={false} style={styles.number}>
                {String(slide.step + 1).padStart(2, "0")}
              </Text>
              <Text
                allowFontScaling={false}
                accessibilityRole="header"
                style={styles.word}
              >
                {t(`onboarding.${slide.id}.word`)}
              </Text>
            </View>
            <Text style={styles.title}>
              {t(`onboarding.${slide.id}.title`)}
            </Text>
            {body ? (
              <Text style={styles.body}>
                {before}
                {highlighted ? (
                  <Text style={styles.highlight}>{highlighted}</Text>
                ) : null}
                {after}
              </Text>
            ) : null}
          </View>
        </Reveal>

        <View style={styles.media} pointerEvents="box-none">
          {slide.id === "record" ? <RecordMedia /> : null}
          {slide.id === "saveFree" || slide.id === "savePro" ? (
            <SaveMedia
              key={slide.id}
              ways={waysOf(slide.id, Platform.OS)}
              card={stories.card}
              onPick={stories.pickCard}
            />
          ) : null}
          {slide.id === "edit" ? <EditMedia /> : null}
          {slide.id === "share" ? <ShareMedia /> : null}
        </View>

        <View style={styles.footer}>
          {last ? (
            <>
              <Text style={styles.note}>{t("onboarding.cameraNote")}</Text>
              {denied ? (
                <>
                  <Text style={styles.denied}>{t("common.cameraDenied")}</Text>
                  <Button
                    label={t("common.openSettings")}
                    variant="secondary"
                    onPress={() => Linking.openSettings()}
                  />
                </>
              ) : null}
              <Button label={t("onboarding.allow")} onPress={allow} />
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={stories.next}
              style={styles.next}
            >
              <Text style={styles.nextText}>{t("onboarding.next")}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  zones: { ...StyleSheet.absoluteFill, flexDirection: "row" },
  zoneBack: { flex: 3 },
  zoneNext: { flex: 7 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  bars: { marginHorizontal: -4 },
  // Only Skip up here: the logo is on the splash screen just before.
  header: {
    height: 44,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  skip: {
    minWidth: 64,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  skipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  copy: { marginBottom: 12 },
  headline: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    height: 56,
    overflow: "hidden",
  },
  number: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.accent,
    paddingBottom: 8,
  },
  word: {
    fontFamily: fonts.displayBold,
    fontSize: 56,
    lineHeight: 56,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    lineHeight: 25,
    color: colors.text,
    marginTop: 6,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: "rgba(255,255,255,0.86)",
    marginTop: 6,
  },
  highlight: { fontFamily: fonts.bodySemi, color: colors.accent },
  media: { flex: 1, minHeight: 0 },
  footer: { gap: 10, paddingTop: 12 },
  note: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.86)",
  },
  denied: {
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.warning,
    textAlign: "center",
  },
  next: {
    height: 54,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: colors.ground,
    alignItems: "center",
    justifyContent: "center",
  },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
});
