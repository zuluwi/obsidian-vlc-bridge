import { parse } from "@plussub/srt-vtt-parser";
import { Entry } from "@plussub/srt-vtt-parser/dist/types";
import { readFileSync } from "fs";
import { Notice } from "obsidian";
import * as path from "path";
//@ts-ignore
import parseAss from "@qgustavor/ass-parser";
import { timestampToSeconds } from "./vlcHelper";
import { DEFAULT_SETTINGS } from "./settings";
import { t } from "./language/helpers";
// import * as iconv from "iconv-lite";
// import * as jschardet from "jschardet";

interface IParsedAssElements {
  section: string;
  body: {
    key: string;
    value: {
      Layer: string;
      Start: string;
      End: string;
      Style: string;
      Name: string;
      MarginL: string;
      MarginR: string;
      MarginV: string;
      Effect: string;
      Text: string;
    };
  }[];
}

export interface ISubEntry extends Entry {
  formattedStr: string;
  posFrom: number;
  posTo: number;
  simpleFormattedStr: string;
}

export const supportedSubtitleFormats = [".srt", ".vtt", ".ass"];

export const getSubEntries = (params: {
  length: { length: number; currentPos?: number | null };
  subPath: string;
  mediaPath: string;
  subDelay: number | null;
  template: string;
}) => {
  let { length, subPath, mediaPath, subDelay, template } = params;
  const length_ = length.length;
  const currentPos = length.currentPos;

  const subExt = path.extname(subPath);
  if (!supportedSubtitleFormats.includes(subExt)) {
    new Notice(`${t("Unsupported subtitle extension")}: ${subExt}`);
    return null;
  }
  let subEntries = parseSub(subPath);
  let formattedEntries: ISubEntry[] = [];
  subEntries
    // ?.slice(0, 15) // for test
    ?.forEach((e, i, arr) => {
      if (currentPos && !(e.from / (length_ * 1000) < currentPos && (i + 1 < arr.length ? arr[i + 1].to / (length_ * 1000) > currentPos : true))) {
        return;
      }
      const entryObj = {
        formattedStr: formatSubText(
          length_ * 1000,
          e,
          i,
          { mediaPath: mediaPath, subPath: subPath, subDelay: subDelay },
          currentPos ? template.replaceAll("{{index}}", e.id || "") : template
        ),
        posFrom: e.from / (length_ * 1000),
        posTo: e.to / (length_ * 1000),
        simpleFormattedStr: formatSubText(length_ * 1000, e, i, { mediaPath: mediaPath, subPath: subPath, subDelay: subDelay }, DEFAULT_SETTINGS.transcriptTemplate),
      };
      formattedEntries.push({ ...e, ...entryObj });
    });

  return formattedEntries;
};

export const parseSub = (subPath: string) => {
  let entries: Entry[];
  let subtitleString = readFileSync(subPath).toString();
  // let subtitleBuffer = readFileSync(subPath);
  // let subtitleEncoding = jschardet.detect(subtitleBuffer);
  // let subtitleString = iconv.decode(subtitleBuffer, subtitleEncoding.encoding);
  // console.log(subtitleString);

  const subExt = path.extname(subPath);
  if (subExt == ".ass") {
    entries = parseAssSub(subtitleString);
  } else {
    entries = parse(subtitleString).entries;
    entries.sort((a, b) => a.from - b.from);
  }
  return entries;
};

/**
 * @param length as milliseconds
 */
export const formatSubText = (
  length: number,
  entry: Entry,
  index: number,
  linkparams: {
    mediaPath: string;
    subPath: string;
    subDelay: number | null;
    // timestamp: string;
  },
  template: string
) => {
  const placeholderIndex = "{{index}}";
  const placeholderFrom = "{{from}}";
  const placeholderTo = "{{to}}";

  let params: { mediaPath: string; subPath: string; subDelay?: string } = {
    mediaPath: encodeURIComponent(linkparams.mediaPath),
    subPath: encodeURIComponent(linkparams.subPath),
  };
  if (linkparams.subDelay && linkparams.subDelay !== 0) {
    params.subDelay = linkparams.subDelay.toString();
  }
  // // shift "from" time slightly to see the subtitles when jumped
  // const posFrom = ((entry.from + 10) / length) * 100;
  const posFrom = (entry.from / length) * 100;
  const posTo = (entry.to / length) * 100;

  entry.text = entry.text.replaceAll(/\s+$/gm, "");
  //   .replaceAll(/^\s*(\-)/gm, "\\$1") // for prevent bullet lists
  //   .replaceAll(/^\s*(\d*)(\.)/gm, "$1\\$2") // for prevent number lists
  //   .replaceAll(/[\*\_\=\~\#\[\]\(\)\`]/g, "\\") // for prevent markdown formatting
  //   .replaceAll(/\r+$/gm, "");

  // for multiline text, repeat {{text}} line in template
  entry.text.split("\n").forEach((text, i, arr) => {
    template = template.replaceAll(/(.*({{text}}).*$)/gm, (matched) => {
      const editedText = `<span>${text}</span>`; // for prevent markdown formatting
      // const editedText = text
      // .replaceAll(/^\s*(\-)/gm, "\\$1") // for prevent bullet lists
      // .replaceAll(/^\s*(\d*)(\.)/gm, "$1\\$2") // for prevent number lists
      // .replaceAll(/[\*\_\=\~\#\[\]\(\)\`]/g, "\\") // for prevent markdown formatting
      // .replaceAll(/\r+$/gm, ""); //
      return matched.replaceAll("{{text}}", editedText) + (i == arr.length - 1 ? "" : `\n${matched}`);
    });
  });

  const fromParamStr = new URLSearchParams({ ...params, timestamp: `${posFrom}%` }).toString();
  const toParamStr = new URLSearchParams({ ...params, timestamp: `${posTo}%` }).toString();
  const tsFrom = `[${msToTimestamp(entry.from).fullString}](obsidian://vlcBridge?${fromParamStr})`;
  const tsTo = `[${msToTimestamp(entry.to).fullString}](obsidian://vlcBridge?${toParamStr})`;

  const formattedStr = template
    .replaceAll(placeholderIndex, (index + 1).toString())
    .replaceAll(placeholderFrom, tsFrom)
    .replaceAll(placeholderTo, tsTo);
  // .replaceAll(placeholderText, entry.text.trim())
  // .replaceAll(/^\s*(\-)/gm, "\\$1")
  // .replaceAll(/^\s*(\d*)(\.)/gm, "$1\\$2");
  // .replaceAll("")
  return formattedStr;
};

// https://stackoverflow.com/a/25279399
export const msToTimestamp = (milliseconds: number) => {
  milliseconds = Math.round(milliseconds);
  let seconds = (milliseconds / 1000).toString().split(".")[0];
  let ms = Math.round(((milliseconds / 1000) % 1) * 1000)
    .toString()
    ?.slice(0, 3);
  let date = new Date(0);
  date.setSeconds(Number(seconds), Number(ms || 0)); // specify value for SECONDS here
  let timeString = date.toISOString().substring(11, 23);
  const simplifiedStr = timeString.substring(milliseconds < 60 * 60 * 1000 ? 3 : 0);
  const result = {
    fullString: timeString,
    simplified: simplifiedStr,
    simplifiedWithoutMs: simplifiedStr.replace(/\.\d*$/, ""),
    hh: timeString.split(":")[0],
    mm: timeString.split(":")[1],
    ss: timeString.split(":")[2].replace(/\.\d*$/, ""),
    ms: timeString.split(".")[1],
  };

  return result;
};

const parseAssSub = (subtitleStr: string) => {
  let parsedAss: IParsedAssElements[] = parseAss(subtitleStr);
  let events = (parsedAss.find((e) => e.section == "Events") as IParsedAssElements).body;
  let mappedEntries = events
    .filter((e) => e.key == "Dialogue")
    .map((e) => {
      // Source https://javascript.plainenglish.io/june-3-parsing-and-validating-svg-paths-with-regex-7bd0e245115
      const isSVGPath = /[ -\dmlhvcsqtaz]{10,}/g;
      let editedText = e.value.Text.replaceAll(isSVGPath, "")
        .replaceAll(/\\[Nn]/g, "\n") // line break
        // .replaceAll(/{\\i[01]}/g, "*") // italic
        // .replaceAll(/{\\b\d+}/g, "**") // bold
        // .replaceAll(/{\\s[01]}/g, "~~") // strikeout
        // .replaceAll(/{\\i1}/g, "<i>") // italic
        // .replaceAll(/{\\i0}/g, "</i>") // italic
        // .replaceAll(/{\\b1}/g, "<b>") // bold
        // .replaceAll(/{\\b0}/g, "</b>") // bold
        .replaceAll(/{\\([ibsu])1}/g, "<$1>") //
        .replaceAll(/{\\([ibsu])}/g, "</$1>") //
        .replaceAll(/{\\.[^{]*}/g, "");
      return { from: timestampToSeconds(e.value.Start) * 1000, to: timestampToSeconds(e.value.End) * 1000, text: editedText };
    })
    .sort((a, b) => a.from - b.from)
    .map((e, i) => {
      return { ...e, id: `${i}` };
    });
  return mappedEntries;
};

export const subtitlePlaceholder = [
  {
    id: "1109",
    from: 4635172,
    to: 4638549,
    text: "Trade skills and hobbies. Goes under\nEducational. The stack behind you.",
  },
  {
    id: "1110",
    from: 4638634,
    to: 4640676,
    text: "The Count Of Monte Crisco.",
  },
  {
    id: "1111",
    from: 4640761,
    to: 4643095,
    text: "That's Cristo, you dumb shit.",
  },
  {
    id: "1112",
    from: 4643180,
    to: 4646974,
    text: "By Alexandree...Dumass.",
  },
  {
    id: "1113",
    from: 4647059,
    to: 4651979,
    text: "Dumb-ass?",
  },
];
