import * as util from "util";
import * as childProcess from "child_process";
const exec = util.promisify(childProcess.exec);

import { Notice, ObsidianProtocolData, Platform, RequestUrlResponse, requestUrl } from "obsidian";
import VLCBridgePlugin from "./main";
import { t } from "./language/helpers";
import { fileURLToPath } from "url";
import isPortReachable from "is-port-reachable";

declare module "obsidian" {
  interface DataAdapter {
    getFullRealPath(arg: string): string;
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

// https://transform.tools/json-to-typescript
export interface vlcStatusResponse {
  fullscreen: boolean;
  // stats: Stats
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

let checkTimeout: ReturnType<typeof setTimeout> | undefined;
let checkInterval: ReturnType<typeof setInterval> | undefined;

export function passPlugin(plugin: VLCBridgePlugin) {
  const getStatus = async () => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    return await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`);
  };

  const checkPort = (timeout?: number) => {
    return new Promise(async (res: (response: object | null) => void, rej) => {
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
        checkInterval = setInterval(async () => {
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

  interface plObject {
    current?: "current";
    duration: number;
    id: string;
    name: string;
    ro: string;
    type: string;
    uri: string;
  }
  const getCurrentVideo = async () => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    return new Promise<string | null>((resolve, reject) => {
      requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
        .then((r) => {
          // @ts-ignore
          const current: plObject | null = r.json?.children?.find((l) => (l.id = "1"))?.children?.find((source: plObject) => source.current);

          if (current) {
            resolve(current.uri);
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

  const findVideoFromPl = (responseJson: object, filePath: string) => {
    // @ts-ignore
    const list = responseJson.children.find((l) => (l.id = "1")).children as plObject[];
    const current = list.find((source: plObject) => source.current);

    if (filePath) {
      if (current && decodeURIComponent(current.uri) == decodeURIComponent(filePath)) {
        return current;
      } else {
        const sameVideoIndex = list.findLastIndex((source: plObject) => source.uri == decodeURIComponent(filePath));
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

  const openVideo = async (params: ObsidianProtocolData | { mediaPath: string; subPath?: string; subDelay?: string; timestamp?: string }) => {
    let { mediaPath, subPath, subDelay, timestamp } = params;
    if (!mediaPath) {
      return new Notice(t("The link does not have a 'mediaPath' parameter to play"));
    }
    mediaPath = decodeURIComponent(mediaPath);

    if (timestamp) {
      timestamp = encodeURI(timestamp);
    }
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
          const status = await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
          if (status.json.state == "stopped") {
            await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_pause`);
          }
          if (subPath && subPath !== currentMedia.subtitlePath) {
            await addSubtitle(subPath, subDelay);
          }
          if (timestamp) {
            requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
          }
        } else {
          await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_play&id=${fileCheck.id}`).then(async (response) => {
            if (response.status == 200 && (await waitStreams())) {
              if (subPath) {
                await addSubtitle(subPath, subDelay);
              }
              if (timestamp) {
                requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
              }
            }
          });
        }
      } else {
        await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=in_play&input=${encodeURIComponent(mediaPath)}`).then(async (response) => {
          if (response.status == 200 && (await waitStreams())) {
            if (subPath) {
              await addSubtitle(subPath, subDelay);
            }
            if (timestamp) {
              requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${timestamp}`);
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
      let streamInterval: ReturnType<typeof setInterval> | undefined;
      streamInterval = setInterval(() => {
        requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`).then(async (response) => {
          if (response.status == 200) {
            const streams = Object.keys(response.json.information.category);
            if (streams.length > 1) {
              resolve(streams);
              streamInterval = clearInterval(streamInterval) as undefined;
              streamTimeout = clearTimeout(streamTimeout) as undefined;
            }
          }
        });
      }, 500);
      streamTimeout = setTimeout(() => {
        if (!streamInterval) {
          streamInterval = clearInterval(streamInterval) as undefined;
          reject();
        }
      }, 10000);
    });
  };

  const addSubtitle = async (filePath: string, subDelay?: string | undefined) => {
    const port_ = currentConfig.port || plugin.settings.port;
    const password_ = currentConfig.password || plugin.settings.password;

    if (filePath.startsWith("file:///")) {
      filePath = fileURLToPath(filePath);
    }

    const response = await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=addsubtitle&val=${encodeURIComponent(filePath)}`);
    // .then(async (response) => {
    if (response?.status == 200) {
      currentMedia.mediaPath = await getCurrentVideo();
      currentMedia.subtitlePath = filePath;
      const subIndex = (await waitStreams()).filter((e) => e !== "meta").length - 1;
      await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=subtitle_track&val=${subIndex}`);
      if (typeof subDelay == "number") {
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

  return { getCurrentVideo, getStatus, checkPort, sendVlcRequest, openVideo, vlcExecOptions, launchVLC, launchSyncplay, addSubtitle };
}
