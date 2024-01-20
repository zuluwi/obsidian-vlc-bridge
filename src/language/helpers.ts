// https://github.com/mgmeyers/obsidian-kanban/blob/main/src/lang/helpers.ts

import { moment } from "obsidian";
import en from "src/language/locale/en";
import tr from "src/language/locale/tr";
const localeMap: { [k: string]: Partial<typeof en> } = {
  //   ar,
  //   cz,
  //   da,
  //   de,
  en,
  //   es,
  //   fr,
  //   hi,
  //   id,
  //   it,
  //   ja,
  //   ko,
  //   nl,
  //   no,
  //   pl,
  //   'pt-BR': ptBR,
  //   pt,
  //   ro,
  //   ru,
  //   sq,
  tr,
  //   uk,
  //   'zh-TW': zhTW,
  //   zh: zhCN,
};
const locale = localeMap[moment.locale()];

export function t(str: keyof typeof en): string {
  if (!locale) {
    console.error("Language couldn't fount:", moment.locale());
  }

  return (locale && locale[str]) || en[str] || str;
}
