// Source: https://github.com/mgmeyers/obsidian-kanban/blob/main/src/lang/helpers.ts

// moment.locale() returns "en" for "am - አማርኛ" and "kh - ខ្មែរ"

import { moment } from "obsidian";
import ar from "./locale/ar";
import cs from "./locale/cs";
import da from "./locale/da";
import de from "./locale/de";
import en from "./locale/en";
import es from "./locale/es";
import fa from "./locale/fa";
import fr from "./locale/fr";
import hi from "./locale/hi";
import hu from "./locale/hu";
import id from "./locale/id";
import it from "./locale/it";
import ja from "./locale/ja";
import ko from "./locale/ko";
import ms from "./locale/ms";
import nl from "./locale/nl";
import no from "./locale/no";
import pl from "./locale/pl";
import pt from "./locale/pt";
import ptBR from "./locale/pt-br";
import ro from "./locale/ro";
import ru from "./locale/ru";
import sq from "./locale/sq";
import th from "./locale/th";
import tr from "./locale/tr";
import uk from "./locale/uk";
import vi from "./locale/vi";
import zhCN from "./locale/zh-cn";
import zhTW from "./locale/zh-tw";

const localeMap: { [k: string]: Partial<typeof en> } = {
  ar,
  cs,
  da,
  de,
  en,
  es,
  fa,
  fr,
  hi,
  hu,
  id,
  it,
  ja,
  ko,
  ms,
  nl,
  no,
  pl,
  "pt-BR": ptBR,
  pt,
  ro,
  ru,
  sq,
  th,
  tr,
  uk,
  vi,
  "zh-TW": zhTW,
  zh: zhCN,
};
const locale = localeMap[moment.locale()];

export function t(str: keyof typeof en): string {
  if (!locale) {
    console.error("Language couldn't fount:", moment.locale());
  }

  return (locale && locale[str]) || en[str] || str;
}
