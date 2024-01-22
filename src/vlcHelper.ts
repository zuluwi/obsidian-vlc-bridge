const util = require("util");
const exec = util.promisify(require("child_process").exec);

import { Notice, RequestUrlResponse, request, requestUrl } from "obsidian";
import VLCNotesPlugin from "./main";
import { t } from "./language/helpers";

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

// export var isVlcOpen: boolean | null = null;
var checkTimeout: ReturnType<typeof setTimeout>;
var checkInterval: ReturnType<typeof setInterval>;

export function passPlugin(plugin: VLCNotesPlugin) {
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
          reject(err);
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

  const openVideo = async (filePath: string, time?: number) => {
    var port_ = currentConfig.port || plugin.settings.port;
    var password_ = currentConfig.password || plugin.settings.password;

    if ((checkInterval as any)?._destroyed == false) {
      return;
    }
    var plInfo = await checkPort();
    if (!plInfo) {
      launchVLC();
      plInfo = await checkPort(5000);
    }

    if (plInfo) {
      var fileCheck = findVideoFromPl(plInfo, filePath);

      // console.log(filePath, currentConfig.currentFile, filePath == currentConfig.currentFile);
      if (fileCheck) {
        if (fileCheck.current && time) {
          requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
        } else {
          await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=pl_play&id=${fileCheck.id}`).then((response) => {
            if (response.status == 200) {
              // currentConfig.currentFile = filePath;
              if (time) {
                requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
              }
            }
          });
        }
      } else {
        await requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=in_play&input=${filePath}`).then((response) => {
          if (response.status == 200) {
            // currentConfig.currentFile = filePath;
            if (time) {
              requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
            }
          }
        });
      }
      if (time) {
        requestUrl(`http://:${password_}@localhost:${port_}/requests/status.json?command=seek&val=${time}`);
      }
    } else {
      new Notice(t("Could not connect to VLC Player."));
    }
  };

  const vlcExecOptions = () => [
    `--extraintf=luaintf:http`,
    `--http-port=${plugin.settings.port}`,
    `--http-password=${plugin.settings.password}`,
    // `--language ${plugin.settings.lang}`,
    // @ts-ignore
    `--snapshot-path="${plugin.app.vault.adapter.getFullRealPath(plugin.settings.snapshotFolder)}"`,
    `--snapshot-format="${plugin.settings.snapshotExt}"`,
    `--snapshot-prefix="${plugin.settings.snapshotPrefix}-"`,
    `--drawable-hwnd=1`,
  ];

  const launchVLC = () => {
    if (!plugin.settings.vlcPath) {
      return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
    }
    // console.log("launchVlc");
    // console.log(`"${plugin.settings.vlcPath}" ${vlcExecOptions().join(" ")}`);

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

  return { getCurrentVideo, getStatus, checkPort, sendVlcRequest, openVideo, vlcExecOptions, launchVLC };
}
