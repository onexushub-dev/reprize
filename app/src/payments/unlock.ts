import { Alert } from "react-native";

import { isFocusSupported } from "../../modules/replay-camera";
import { repo } from "../data/mmkv";
import type { TFunction } from "../i18n";
import { track } from "../analytics";
import type { PaywallSource } from "../analytics/events";
import { openPaywall } from "./feedback";
import { payments } from ".";

/** Asks before a Pass kept from before goes to this recording; resolves true for "use it". */
function askUsePass(t: TFunction): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t("unlock.title"),
      t(isFocusSupported() ? "unlock.message" : "unlock.messageNoFocus"),
      [
        {
          text: t("unlock.keep"),
          style: "cancel",
          onPress: () => resolve(false),
        },
        { text: t("unlock.use"), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * "Liberar recursos PRO nessa gravação": opens a recording already made for the paid export (Full HD, sound, Modo Foco,
 * no mark, compile). Pro does it at once; a Pass kept from before after the player agrees to use it here; with neither,
 * the Single Pass paywall opens and the Pass bought there goes to this recording. A Pass is never spent anywhere else.
 * Returns whether the recording is paid now.
 */
export async function unlockRecording(
  sessionId: string,
  t: TFunction,
  source: PaywallSource = "export_limit",
): Promise<boolean> {
  let option = payments.unlockOption();
  let boughtHere = false;
  if (option.kind === "none") {
    const outcome = await openPaywall(t, source, "pass");
    if (outcome !== "purchased" && outcome !== "restored") return false;
    boughtHere = outcome === "purchased";
    option = payments.unlockOption();
  }
  if (option.kind === "none") return false;
  if (option.kind === "credit") {
    // A Pass bought just now was bought for this recording; one kept from before is used after the player agrees.
    if (!boughtHere) {
      if (!(await askUsePass(t))) return false;
      track("pass_used");
    }
    return (
      repo.upgradeSession(sessionId, {
        passTransactionId: option.passTransactionId,
      }) !== undefined
    );
  }
  return repo.upgradeSession(sessionId, {}) !== undefined;
}
