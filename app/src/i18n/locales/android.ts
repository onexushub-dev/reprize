import type { AppLocale } from "../locale";
import type { Messages } from "./en";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>;
};

/**
 * Android wording for the texts that name iOS places: the system settings app is "Configurações" / "Settings" (not
 * "Ajustes"), the gallery is the gallery (not "Photos"), and the Bluetooth steps follow Android's own menus. Merged over
 * the catalogs on Android only (see i18n/index.ts); anything not here is the same on both platforms.
 */
export const androidOverrides: Record<AppLocale, DeepPartial<Messages>> = {
  "pt-BR": {
    common: {
      openSettings: "Abrir Configurações",
      cameraDenied:
        "Sem câmera não dá para gravar os clipes. Libere nas Configurações.",
    },
    clip: {
      noPhotos: "Sem acesso à galeria. Libere nas Configurações.",
      savedHint: "Está na galeria do celular.",
    },
    devices: {
      step2:
        "No celular, abra Configurações > Dispositivos conectados > Parear novo dispositivo e toque no nome dele.",
      forgetHelp:
        "O Reprize esquece que este controle já foi usado aqui. Para desparear de vez: Configurações > Dispositivos conectados > ⚙ ao lado do controle > Esquecer.",
      note: "Nada ainda? Confira se o controle aparece como conectado em Configurações > Dispositivos conectados. Funciona com controles de selfie (tecla de volume).",
      noteBluetoothOff:
        "Ligue o Bluetooth do celular nas Configurações rápidas ou em Configurações.",
    },
  },
  en: {
    batch: {
      saved: {
        one: "%{count} clip saved to the gallery.",
        other: "%{count} clips saved to the gallery.",
      },
    },
    summary: {
      savedTag: "In gallery",
      savedA11y: "%{label}, saved to the gallery",
    },
    clip: {
      noPhotos: "No access to the gallery. Allow it in Settings.",
      savedToPhotos: "Saved to the gallery.",
      saveToPhotos: "Save to gallery",
      savedHint: "It's in the phone's gallery.",
      exportSaving: "Saving to the gallery…",
    },
    devices: {
      step2:
        "Open Settings > Connected devices > Pair new device and tap its name.",
      forgetHelp:
        "Reprize forgets this remote was used here. To unpair it for good: Settings > Connected devices > ⚙ next to the remote > Forget.",
      note: "Nothing yet? Check that the remote shows as connected in Settings > Connected devices. Works with selfie remotes (volume key).",
      noteBluetoothOff: "Turn on Bluetooth in Quick Settings or Settings.",
    },
  },
};
