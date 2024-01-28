const util = require("util");
const exec = util.promisify(require("child_process").exec);

import { Notice, RequestUrlResponse, request, requestUrl } from "obsidian";
import VLCBridgePlugin from "./main";
import { t } from "./language/helpers";
import { fileURLToPath } from "url";
import isPortReachable from "is-port-reachable";

interface config {
  port: number | null;
  password: string | null;
  snapshotPrefix: string | null;
  snapshotFolder: string | null;
  snapshotExt: "png" | "jpg" | "tiff";
  vlcPath: string;
  lang: string;
}
export const currentConfig: config = {
  port: null,
  password: null,
  snapshotPrefix: null,
  snapshotFolder: null,
  snapshotExt: "png",
  vlcPath: "",
  lang: "en",
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
    category: {};
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
  equalizer: any[];
}

// export var isVlcOpen: boolean | null = null;
var checkTimeout: ReturnType<typeof setTimeout>;
var checkInterval: ReturnType<typeof setInterval>;

export function passPlugin(plugin: VLCBridgePlugin) {
  const getStatus = async () => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    return await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`);
  };

  const checkPort = (timeout?: number) => {
    return new Promise((res: (response: object | null) => void, rej) => {
      var port_ = currentConfig.port || plugin.settings.port;
      var password_ = currentConfig.password || plugin.settings.password;

      requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
        .then((response) => {
          if (response.status == 200) {
            clearInterval(checkInterval);
            clearTimeout(checkTimeout);
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
      if (timeout) {
        checkInterval = setInterval(async () => {
          requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
            .then((response) => {
              if (response.status == 200) {
                clearInterval(checkInterval);
                clearTimeout(checkTimeout);
                res(response.json);
              }
            })
            .catch((err) => {});
        }, 200);

        checkTimeout = setTimeout(() => {
          if (!(checkInterval as any)._destroyed) {
            clearInterval(checkInterval);
            res(null);
          }
        }, timeout || 10000);
      }
    });
  };

  const sendVlcRequest = async (command: string) => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    if ((checkInterval as any)?._destroyed == false) {
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
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    return new Promise<string | null>((resolve, reject) => {
      requestUrl(`http://:${password_}@localhost:${port_}/requests/playlist.json`)
        .then((r) => {
          // @ts-ignore
          var current: plObject | null = r.json?.children?.find((l) => (l.id = "1"))?.children?.find((source: plObject) => source.current);

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
    var list = responseJson.children.find((l) => (l.id = "1")).children as plObject[];
    var current = list.find((source: plObject) => source.current);

    if (filePath) {
      if (current && decodeURIComponent(current.uri) == decodeURIComponent(filePath)) {
        return current;
      } else {
        // @ts-ignore
        var sameVideoIndex = list.findLastIndex((source: plObject) => source.uri == decodeURIComponent(filePath));
        if (sameVideoIndex !== -1) {
          var sameVideo = list[sameVideoIndex];
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

  const openVideo = async ({ filePath, subPath, subDelay, time }: { filePath: string; subPath?: string; subDelay?: number; time?: number }) => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    if ((checkInterval as any)?._destroyed == false) {
      return;
    }
    var plInfo = await checkPort();
    if (!plInfo) {
      if (!plugin.settings.vlcPath) {
        return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
      }
      launchVLC();
      plInfo = await checkPort(5000);
    }

    if (plInfo) {
      var fileCheck = findVideoFromPl(plInfo, filePath);

      // console.log(filePath, currentConfig.currentFile, filePath == currentConfig.currentFile);
      if (fileCheck) {
        if (fileCheck.current) {
          if (time) {
            requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
          }
          if (subPath && subPath !== currentMedia.subtitlePath) {
            addSubtitle(subPath, subDelay);
          }
        } else {
          await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_play&id=${fileCheck.id}`).then(async (response) => {
            if (response.status == 200 && (await waitStreams())) {
              // currentConfig.currentFile = filePath;
              if (time) {
                requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
              }
              if (subPath) {
                addSubtitle(subPath, subDelay);
              }
            }
          });
        }
      } else {
        await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=in_play&input=${encodeURIComponent(filePath)}`).then(async (response) => {
          if (response.status == 200 && (await waitStreams())) {
            // currentConfig.currentFile = filePath;
            if (time) {
              requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
            }
            if (subPath) {
              addSubtitle(subPath, subDelay);
            }
          }
        });
        // if (time) {
        //   requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
        // }
      }
    } else {
      new Notice(t("Could not connect to VLC Player."));
    }
  };

  const waitStreams = () => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;
    return new Promise<string[]>((resolve, reject) => {
      let streamTimeout: ReturnType<typeof setTimeout>;
      let streamInterval: ReturnType<typeof setInterval>;
      streamInterval = setInterval(() => {
        requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json`).then(async (response) => {
          if (response.status == 200) {
            let streams = Object.keys(response.json.information.category);
            if (streams.length > 1) {
              resolve(streams);
              clearInterval(streamInterval);
              clearTimeout(streamTimeout);
            }
          }
        });
      }, 500);
      streamTimeout = setTimeout(() => {
        if (!(streamInterval as any)._destroyed) {
          clearInterval(streamInterval);
          reject();
        }
      }, 10000);
    });
  };

  const addSubtitle = async (filePath: string, subDelay?: number | undefined) => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    if (filePath.startsWith("file:///")) {
      filePath = fileURLToPath(filePath);
      // filePath = filePath.substring(7).replace(/\//g, "\\");
    }

    requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=addsubtitle&val=${encodeURIComponent(filePath)}`).then(async (response) => {
      if (response.status == 200) {
        currentMedia.mediaPath = await getCurrentVideo();
        currentMedia.subtitlePath = filePath;
        let subIndex = (await waitStreams()).filter((e) => e !== "meta").length - 1;
        requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=subtitle_track&val=${subIndex}`);
        if (subDelay) {
          requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=subdelay&val=${subDelay}`);
        }
      }
    });
  };

  const vlcExecOptions = () => [
    `--extraintf=luaintf:http`,
    `--http-port=${plugin.settings.port}`,
    `--http-password=${plugin.settings.password}`,
    // `--language ${plugin.settings.lang}`,
    `--snapshot-path="${plugin.app.vault.adapter.getFullRealPath(plugin.settings.snapshotFolder)}"`,
    `--snapshot-format="${plugin.settings.snapshotExt}"`,
    `--snapshot-prefix="${plugin.settings.snapshotPrefix}-"`,
    `--drawable-hwnd=1`,
    `${plugin.settings.alwaysOnTop ? "--video-on-top" : ""}`,
  ];

  const launchVLC = async () => {
    // console.log("launchVlc");
    // console.log(`"${plugin.settings.vlcPath}" ${vlcExecOptions().join(" ")}`);
    if (await isPortReachable(plugin.settings.port, { host: "localhost" })) {
      return new Notice(t("The port you selected is not usable, please enter another port value"));
    }
    exec(`"${plugin.settings.vlcPath}" ${vlcExecOptions().join(" ")}`)
      .finally(() => {
        if (checkInterval) {
          clearInterval(checkInterval);
          clearTimeout(checkTimeout);
        }
      })
      .catch((err: Error) => {
        if (checkInterval) {
          clearInterval(checkInterval);
          clearTimeout(checkTimeout);
        }
        console.log("VLC Launch Error", err);
        new Notice(t("The vlc.exe specified in the settings could not be run, please check again!"));
      });
    currentConfig.vlcPath = plugin.settings.vlcPath;
    currentConfig.port = plugin.settings.port;
    currentConfig.password = plugin.settings.password;
    currentConfig.lang = plugin.settings.lang;
    currentConfig.snapshotFolder = plugin.settings.snapshotFolder;
    currentConfig.snapshotExt = plugin.settings.snapshotExt;
  };

  return { getCurrentVideo, getStatus, checkPort, sendVlcRequest, openVideo, vlcExecOptions, launchVLC, addSubtitle };
}
