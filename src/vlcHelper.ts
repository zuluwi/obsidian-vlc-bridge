import * as util from "util";
import * as childProcess from "child_process";
const exec = util.promisify(childProcess.exec);

import { Notice, ObsidianProtocolData, Platform, RequestUrlResponse, requestUrl } from "obsidian";
import VLCBridgePlugin from "./main";
import { t } from "./language/helpers";
import { fileURLToPath, pathToFileURL } from "url";
import isPortReachable from "is-port-reachable";

declare module "obsidian" {
  interface DataAdapter {
    getFullRealPath(arg: string): string;
    getFilePath(arg: string): string;
  }
}
interface config {
  port: number | null;
  password: string | null;
  snapshotPrefix: string | null;
  snapshotFolder: string | null;
  snapshotExt: "png" | "jpg" | "tiff";
  vlcPath: string;
}
export const currentConfig: config = {
  port: null,
  password: null,
  snapshotPrefix: null,
  snapshotFolder: null,
  snapshotExt: "png",
  vlcPath: "",
};

export const currentMedia: {
  mediaPath: string | null;
  subtitlePath: string | null;
} = {
  mediaPath: null,
  subtitlePath: null,
};

const temporaryLengthData: { mediaPath: string; length: number }[] = [];

// https://transform.tools/json-to-typescript
export interface vlcStatusResponse {
  fullscreen: boolean;
  // stats: Stats
  stats: {
    inputbitrate: number;
    sentbytes: number;
    lostabuffers: number;
    averagedemuxbitrate: number;
    readpackets: number;
    demuxreadpackets: number;
    lostpictures: number;
    displayedpictures: number;
    sentpackets: number;
    demuxreadbytes: number;
    demuxbitrate: number;
    playedabuffers: number;
    demuxdiscontinuity: number;
    decodedaudio: number;
    sendbitrate: number;
    readbytes: number;
    averageinputbitrate: number;
    demuxcorrupted: number;
    decodedvideo: number;
  };
  aspectratio: string;
  seek_sec: number;
  apiversion: number;
  currentplid: number;
  time: number;
  volume: number;
  length: number;
  random: boolean;
  // audiofilters: Audiofilters
  information: {
    chapter: number;
    chapters: number[];
    title: number;
    category: { [key: string]: { [key: string]: string } };
    titles: number[];
  };
  rate: number;
  // videoeffects: Videoeffects
  state: string;
  loop: boolean;
  version: string;
  position: number;
  audiodelay: number;
  repeat: boolean;
  subtitledelay: number;
  equalizer: [];
}

export interface vlcRequestResponse extends RequestUrlResponse {
  json: vlcStatusResponse;
}

interface plResponse {
  ro: string;
  type: string;
  name: string;
  id: string;
  children: Array<{
    ro: string;
    type: string;
    name: string;
    id: string;
    children: Array<plObject>;
  }>;
}

export interface plObject {
  current?: "current";
  duration: number;
  id: string;
  name: string;
  ro: string;
  type: string;
  uri: string;
}

let checkTimeout: ReturnType<typeof setTimeout> | undefined;
let checkInterval: number | undefined; //ReturnType<typeof setInterval> | undefined;

export function passPlugin(plugin: VLCBridgePlugin) {
  const getStatus = async () => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;
    if (!(await isPortReachable(plugin.settings.port, { host: "localhost" }))) {
      new Notice(t("Could not connect to VLC Player."));
      return undefined;
    }
    try {
      const response: vlcRequestResponse = await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`);
      if (response.status == 200) {
        return response.json;
      } else {
        return undefined;
      }
    } catch (error) {
      console.log("getStatus Error:", error);
      return undefined;
    }
  };

  const checkPort = (timeout?: number) => {
    return new Promise(async (res: (playlistResponse: plResponse | null) => void, rej) => {
      const port_ = currentConfig.port || plugin.settings.port;
      const password_ = currentConfig.password || plugin.settings.password;

      if (!timeout && !(await isPortReachable(plugin.settings.port, { host: "localhost" }))) {
        res(null);
      } else {
        requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
          .then((response) => {
            if (response.status == 200) {
              checkInterval = clearInterval(checkInterval) as undefined;
              checkTimeout = clearTimeout(checkTimeout) as undefined;

              res(response.json);
            } else if (!timeout) {
              res(null);
            }
          })
          .catch((err: Error) => {
            if (!timeout) {
              res(null);
            }
          });
      }
      if (timeout) {
        checkInterval = window.setInterval(async () => {
          requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
            .then((response) => {
              if (response.status == 200) {
                checkInterval = clearInterval(checkInterval) as undefined;
                checkTimeout = clearTimeout(checkTimeout) as undefined;
                res(response.json);
              }
            })
            .catch((err) => {});
        }, 200);

        plugin.registerInterval(checkInterval);

        checkTimeout = setTimeout(() => {
          if (checkInterval) {
            checkInterval = clearInterval(checkInterval) as undefined;
            res(null);
          }
        }, timeout || 10000);
      }
    });
  };

  // Reference: https://code.videolan.org/videolan/vlc-3.0/-/blob/master/share/lua/http/requests/README.txt
  const sendVlcRequest = async (command: string) => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    if (checkInterval) {
      return;
    }
    if (!(await isPortReachable(plugin.settings.port, { host: "localhost" }))) {
      new Notice(t("Could not connect to VLC Player."));
      return;
    }
    return new Promise<RequestUrlResponse>((resolve, reject) => {
      requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=${command}`)
        .then((r) => {
          resolve(r);
        })
        .catch((err) => {
          console.log("vlc request error:", err);
          new Notice(t("Could not connect to VLC Player."));
          reject(err);
        });
    });
  };

  const editTimestamp = async (timestamp: string | undefined, mediaPath: string) => {
    if (!timestamp) return "";
    // Source: https://regex101.com/library/RVP0ke
    // const timecodePattern = /^(\d+:)?([0-5][0-9]:)?([0-5][0-9])([|.|,]\d+)?$/gm;
    const timecodePattern = /^(\d+:)?([0-5][0-9]:)?((([0-5][0-9])([|.|,]\d+)?)|(\d+([|.|,]\d+)?))$/gm;
    if (Number.isInteger(Number(timestamp))) {
      return timestamp;
    }
    if (timestamp.endsWith("%")) {
      return encodeURI(timestamp);
    }
    if (timecodePattern.test(timestamp)) {
      const seconds = timestampToSeconds(timestamp);
      const length = (await getLength({ dontBackCurrentPos: true, onlyGetLength: true, mediaPath }))?.length;

      if (length) {
        return encodeURI(`${(seconds / length) * 100}%`);
      } else {
        return `${Math.floor(seconds)}`;
      }
    }
    new Notice(t("Timestamp is not valid"));
    return "";
  };

  const getCurrentVideo = async () => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    return new Promise<plObject | null>(async (resolve, reject) => {
      if (!(await isPortReachable(plugin.settings.port, { host: "localhost" }))) {
        new Notice(t("Could not connect to VLC Player."));
        resolve(null);
        return;
      }
      requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
        .then((r) => {
          const plResponse: plResponse = r.json;
          const current: plObject | undefined = plResponse?.children?.find((l) => (l.id = "1"))?.children?.find((source: plObject) => source.current);
          if (current) {
            resolve(current);
          } else {
            resolve(null);
          }
        })
        .catch((err) => {
          console.log("vlc request error:", err);
          new Notice(t("Could not connect to VLC Player."));
          resolve(null);
        });
    });
  };

  const findVideoFromPl = (responseJson: plResponse, filePath: string) => {
    filePath = decodeURIComponent(filePath);
    const list = responseJson.children.find((l) => (l.id = "1"))?.children as plObject[];
    const current = list.find((source: plObject) => source.current);
    if (!filePath.startsWith("file:///")) {
      filePath = pathToFileURL(filePath).href;
    }

    if (filePath) {
      if (current && decodeURIComponent(current.uri) == filePath) {
        return current;
      } else {
        const sameVideoIndex = list.findLastIndex((source: plObject) => decodeURIComponent(source.uri) == filePath);
        if (sameVideoIndex !== -1) {
          const sameVideo = list[sameVideoIndex];
          return sameVideo;
        } else {
          return null;
        }
      }
    } else {
      if (current) {
        return current;
      } else {
        return null;
      }
    }
  };

  const openVideo = async (params: ObsidianProtocolData | { mediaPath: string; subPath?: string; subDelay?: string; timestamp?: string; pause?: boolean }) => {
    let { mediaPath, subPath, subDelay, timestamp, pause } = params;
    if (!mediaPath) {
      return new Notice(t("The link does not have a 'mediaPath' parameter to play"));
    }
    mediaPath = decodeURIComponent(mediaPath);

    if (subPath) {
      subPath = decodeURIComponent(subPath);
    }

    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    if (checkInterval) {
      return;
    }
    let plInfo = await checkPort();
    if (!plInfo) {
      if (!(plugin.settings.vlcPath || plugin.cliExist)) {
        if (Platform.isWin) {
          return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
        } else {
          return new Notice(t("To use the plugin, the ‘vlc’ command must be installed on your system."));
        }
      }
      launchVLC();
      plInfo = await checkPort(5000);
    }

    if (plInfo) {
      const fileCheck = findVideoFromPl(plInfo, mediaPath);

      if (fileCheck) {
        if (fileCheck.current) {
          timestamp = await editTimestamp(timestamp, mediaPath);

          const status = await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp || ""}`);
          if (status.json.state == "stopped") {
            await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_pause`);
          }
          if (subPath && subPath !== currentMedia.subtitlePath) {
            await addSubtitle(subPath, subDelay);
          }
          if (status.json.state == "stopped" && timestamp.length) {
            await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
          }
        } else {
          await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_play&id=${fileCheck.id}`).then(async (response) => {
            if (response.status == 200 && (await waitStreams())) {
              if (pause) {
                await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_forcepause`);
              }
              if (subPath) {
                await addSubtitle(subPath, subDelay);
              }
              timestamp = await editTimestamp(timestamp, mediaPath);
              if (timestamp.length) {
                await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
              }
            }
          });
        }
      } else {
        await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=in_play&input=${encodeURIComponent(mediaPath)}`).then(async (response) => {
          if (response.status == 200 && (await waitStreams())) {
            if (pause) {
              await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_forcepause`);
            }
            if (subPath) {
              await addSubtitle(subPath, subDelay);
            }
            timestamp = await editTimestamp(timestamp, mediaPath);
            if (timestamp.length) {
              await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
            }
          }
        });
      }
    } else {
      new Notice(t("Could not connect to VLC Player."));
    }
  };

  const waitStreams = () => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;
    return new Promise<string[]>((resolve, reject) => {
      let streamTimeout: ReturnType<typeof setTimeout> | undefined;
      let streamInterval: number | undefined; //ReturnType<typeof setInterval> | undefined;
      streamInterval = window.setInterval(() => {
        requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`).then(async (response) => {
          if (response.status == 200) {
            const streams = Object.keys(response.json.information?.category);
            if (streams.length > 1) {
              resolve(streams);
              streamInterval = clearInterval(streamInterval) as undefined;
              streamTimeout = clearTimeout(streamTimeout) as undefined;
            }
          }
        });
      }, 500);
      plugin.registerInterval(streamInterval);

      streamTimeout = setTimeout(() => {
        if (streamInterval) {
          streamInterval = clearInterval(streamInterval) as undefined;
          reject();
        }
      }, 10000);
    });
  };

  const addSubtitle = async (subtitlePath: string, subDelay?: string | undefined) => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    if (subtitlePath.startsWith("file:///")) {
      subtitlePath = fileURLToPath(subtitlePath);
    }

    const response = await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=addsubtitle&val=${encodeURIComponent(subtitlePath)}`);
    // .then(async (response) => {
    if (response?.status == 200) {
      currentMedia.mediaPath = (await getCurrentVideo())?.uri as string; // as decoded
      currentMedia.subtitlePath = subtitlePath;
      const subIndex = (await waitStreams()).filter((e) => e !== "meta").length - 1;
      await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=subtitle_track&val=${subIndex}`);
      if (subDelay) {
        await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=subdelay&val=${subDelay}`);
      }
    }
    // });
  };

  // Reference: https://wiki.videolan.org/VLC_command-line_help/
  const vlcExecOptions = (type: "syncplay" | "vlc") => [
    `${
      type == "syncplay"
        ? `${
            plugin.settings.spCommandPath == "spPath" && plugin.settings.syncplayPath
              ? `"${plugin.settings.syncplayPath}"`
              : plugin.spCliExist || `"${plugin.settings.syncplayPath}"`
          } --player-path`
        : ""
    }`,
    `${plugin.settings.commandPath == "vlcPath" && plugin.settings.vlcPath ? `"${plugin.settings.vlcPath}"` : plugin.cliExist || `"${plugin.settings.vlcPath}"`}`,
    `${type == "syncplay" ? "--" : ""}`,
    `--extraintf=luaintf:http`,
    `--http-port=${plugin.settings.port}`,
    `--http-password=${plugin.settings.password}`,
    `--snapshot-path="${plugin.app.vault.adapter.getFullRealPath(plugin.settings.snapshotFolder)}"`,
    `--snapshot-format="${plugin.settings.snapshotExt}"`,
    `--snapshot-prefix="${plugin.settings.snapshotPrefix}-"`,
    `--drawable-hwnd=1`,
    `${plugin.settings.alwaysOnTop ? "--video-on-top" : ""}`,
  ];

  const launchVLC = async () => {
    if (await isPortReachable(plugin.settings.port, { host: "localhost" })) {
      return new Notice(t("The port you selected is not usable, please enter another port value"));
    }
    exec(vlcExecOptions("vlc").join(" "))
      .finally(() => {
        if (checkInterval) {
          checkInterval = clearInterval(checkInterval) as undefined;
          checkTimeout = clearTimeout(checkTimeout) as undefined;
        }
      })
      .catch((err: Error) => {
        if (checkInterval) {
          checkInterval = clearInterval(checkInterval) as undefined;
          checkTimeout = clearTimeout(checkTimeout) as undefined;
        }
        console.log("VLC Launch Error", err);
        // new Notice(t("The vlc.exe specified in the settings could not be run, please check again!"));
      });
    // currentConfig.vlcPath = plugin.settings.vlcPath;
    currentConfig.port = plugin.settings.port;
    currentConfig.password = plugin.settings.password;
    currentConfig.snapshotFolder = plugin.settings.snapshotFolder;
    currentConfig.snapshotExt = plugin.settings.snapshotExt;
  };

  const launchSyncplay = async () => {
    if (!(plugin.settings.syncplayPath || plugin.spCliExist)) {
      if (Platform.isWin) {
        return new Notice(t("Before you can use this command, you need to select 'Syncplay.exe' in the plugin settings"));
      } else {
        return new Notice(t("To use the command, the ‘syncplay’ command must be installed on your system."));
      }
    }
    if (await isPortReachable(plugin.settings.port, { host: "localhost" })) {
      return new Notice(t("The port you selected is not usable, please enter another port value"));
    }

    // Reference: https://syncplay.pl/guide/client/
    exec(vlcExecOptions("syncplay").join(" "))
      .finally(() => {})
      .catch((err: Error) => {
        console.log("Syncplay Launch Error", err);
        new Notice(t("The vlc.exe specified in the settings could not be run, please check again!"));
      });
    // currentConfig.vlcPath = plugin.settings.vlcPath;
    currentConfig.port = plugin.settings.port;
    currentConfig.password = plugin.settings.password;
    currentConfig.snapshotFolder = plugin.settings.snapshotFolder;
    currentConfig.snapshotExt = plugin.settings.snapshotExt;
  };

  const getLength = async (params: { mediaPath?: string | null; onlyGetLength?: boolean; dontBackCurrentPos?: boolean }) => {
    let { mediaPath, onlyGetLength, dontBackCurrentPos } = params;
    if (!mediaPath) {
      mediaPath = (await getCurrentVideo())?.uri;
    }
    const existingLengthData = temporaryLengthData.find((e) => e.mediaPath == mediaPath && e.length);
    if (onlyGetLength && existingLengthData) {
      return { length: existingLengthData.length };
    }

    const status: vlcStatusResponse = (await sendVlcRequest(""))?.json;
    if (!status) {
      return;
    }
    const currentPos = status.position;

    let length: number;

    if (existingLengthData) {
      length = existingLengthData.length;
    } else {
      if (status.state == "stopped") {
        await sendVlcRequest("pl_pause");
      }
      const seekedStatus: vlcStatusResponse = (await sendVlcRequest("seek&val=1"))?.json;
      const seekedPos = seekedStatus.position;

      if (!dontBackCurrentPos) {
        await sendVlcRequest(`seek&val=${currentPos * 100}%25`);
      }
      length = 1 / seekedPos;
    }

    const currentPosAsMs = length * currentPos * 1000;
    if (mediaPath && !existingLengthData) {
      temporaryLengthData.push({ mediaPath, length });
    }
    return { length, currentPos, currentPosAsMs, status };
  };

  return { getCurrentVideo, getStatus, checkPort, sendVlcRequest, openVideo, vlcExecOptions, launchVLC, launchSyncplay, addSubtitle, getLength };
}

/**
 *
 * @param timestamp
 * @returns as decimal number
 */
export const timestampToSeconds = (timestamp: string) => {
  const hhmmss = timestamp.split(":");
  const s = Number(hhmmss.at(-1)?.replace(",", ".") || 0);
  const mmToSeconds = Number(hhmmss.at(-2) || 0) * 60;
  const hhToSeconds = Number(hhmmss.at(-3) || 0) * 60 * 60;
  const seconds = s + mmToSeconds + hhToSeconds;

  return seconds;
};
