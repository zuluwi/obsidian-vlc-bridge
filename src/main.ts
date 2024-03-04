import { App, Editor, MarkdownView, Modal, Notice, ObsidianProtocolData, Plugin, PluginSettingTab, RequestUrlResponse, RequestUrlResponsePromise, Setting } from "obsidian";
import { DEFAULT_SETTINGS, VBPluginSettingsTab, VBPluginSettings } from "./settings";
import { passPlugin, currentConfig, currentMedia, vlcStatusResponse } from "./vlcHelper";
import { t } from "./language/helpers";

declare global {
  interface File {
    readonly path: string;
  }
}

export default class VLCBridgePlugin extends Plugin {
  settings: VBPluginSettings;
  openVideoIcon: HTMLElement;
  openVideo: (params: ObsidianProtocolData | { mediaPath: string; subPath?: string; subDelay?: string; timestamp?: string }) => void;
  addSubtitle: (filePath: string, subDelay?: string) => void;
  sendVlcRequest: (command: string) => Promise<RequestUrlResponse | undefined>;
  getStatus: () => Promise<RequestUrlResponse>;
  checkPort: (timeout?: number) => Promise<object | null>;
  getCurrentVideo: () => Promise<string | null>;
  vlcExecOptions: () => string[];
  launchSyncplay: () => void;

  async onload() {
    await this.loadSettings();
    this.setSidebarIcon();

    var { getStatus, getCurrentVideo, checkPort, sendVlcRequest, openVideo, launchVLC, launchSyncplay, vlcExecOptions, addSubtitle } = passPlugin(this);
    this.openVideo = openVideo;
    this.addSubtitle = addSubtitle;
    this.sendVlcRequest = sendVlcRequest;
    this.getStatus = getStatus;
    this.checkPort = checkPort;
    this.getCurrentVideo = getCurrentVideo;
    this.vlcExecOptions = vlcExecOptions;
    this.launchSyncplay = launchSyncplay;

    this.registerObsidianProtocolHandler("vlcBridge", (params: ObsidianProtocolData) => {
      this.openVideo(params);
    });

    this.registerObsidianProtocolHandler("vlcBridge-runSyncplay", () => {
      this.launchSyncplay();
    });

    // Reference: https://discord.com/channels/686053708261228577/840286264964022302/1085905134409752576 | @lemons_dev
    // const plugin = this;
    // this.app.workspace.openLinkText = (function (_super) {
    //   return function () {
    //     console.log("Function Mixin openLinkText", arguments, Object.fromEntries(new URLSearchParams(arguments[0]).entries()));
    //     let linktext = arguments[0] as string;
    //     if (linktext.toLowerCase().startsWith("vlcbridge?")) {
    //       let vlcParams = Object.fromEntries(new URLSearchParams(linktext.substring(10)).entries());
    //       console.log(vlcParams);

    //       if (vlcParams.mediaPath) {
    //         plugin.openVideo(vlcParams as { mediaPath: string; subPath?: string; subDelay?: string; timestamp?: string });
    //       } else {
    //         return _super.apply(this, arguments);
    //       }
    //     } else {
    //       // @ts-ignore
    //       return _super.apply(this, arguments);
    //     }
    //   };
    // })(this.app.workspace.openLinkText);

    this.addCommand({
      id: "paste-video-path-with-timestamp",
      name: t("Paste timestamped link of current video"),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (this.settings.pauseOnPasteLink) {
          this.sendVlcRequest("pl_forcepause");
        }
        try {
          var status = await this.getStatus();
        } catch (error) {
          // if (!currentStatusResponse) {
          console.log(error);
          return new Notice(t("VLC Player must be open to use this command"));
          // }
        }
        var timestampLink = await this.getTimestampLink(status);
        var templateStr = this.settings.timestampLinkTemplate.replace(/{{timestamplink}}/g, timestampLink.link);

        editor.replaceSelection(`${templateStr}`);
      },
    });

    this.addCommand({
      id: "open-video-with-vlc",
      icon: "lucide-video",
      name: t("Select a file to open with VLC Player"),
      callback: async () => {
        this.fileOpen();
      },
    });

    this.addCommand({
      id: "open-syncplay",
      name: t("Start Syncplay with plugin arguments"),
      callback: async () => {
        this.launchSyncplay();
      },
    });

    this.addCommand({
      id: "add-subtitle",
      icon: "lucide-subtitles",
      name: t("Add subtitles"),
      callback: async () => {
        this.subtitleOpen();
      },
    });

    this.addCommand({
      id: "vlc-go-next-frame",
      name: t("Next frame"),
      repeatable: true,
      callback: async () => {
        this.seekFrame("+");
      },
    });

    this.addCommand({
      id: "vlc-go-previous-frame",
      name: t("Previous frame"),
      repeatable: true,
      callback: async () => {
        this.seekFrame("-");
      },
    });

    this.addCommand({
      id: "vlc-normal-seek-forward",
      name: t("Seek forward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=+${this.settings.normalSeek}`);
      },
    });

    this.addCommand({
      id: "vlc-normal-seek-backward",
      name: t("Seek backward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=-${-this.settings.normalSeek}`);
      },
    });
    this.addCommand({
      id: "vlc-large-seek-forward",
      name: t("Long seek forward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=+${this.settings.largeSeek}`);
      },
    });

    this.addCommand({
      id: "vlc-large-seek-backward",
      name: t("Long seek backward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=-${-this.settings.largeSeek}`);
      },
    });

    this.addCommand({
      id: "vlc-toggle-fullscreen",
      name: t("Toggle fullscreen"),
      callback: async () => {
        this.sendVlcRequest(`fullscreen`);
      },
    });

    this.addCommand({
      id: "vlc-toggle-play",
      name: t("Toggle play/pause"),
      callback: async () => {
        this.sendVlcRequest(`pl_pause`);
      },
    });

    this.addCommand({
      id: "vlc-paste-snapshot",
      name: t("Take and paste snapshot from video"),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        // callback: async () => {
        if (currentConfig.snapshotFolder && !(await this.app.vault.adapter.exists(currentConfig.snapshotFolder))) {
          this.app.vault.adapter.mkdir(currentConfig.snapshotFolder);
        }
        if (currentConfig.snapshotFolder && currentConfig.snapshotFolder !== this.settings.snapshotFolder) {
          new Notice(t("You must restart VLC for the snapshots to be saved in the folder you set."));
        }
        try {
          var status = await this.getStatus();
        } catch (error) {
          console.log(error);
          return new Notice(t("VLC Player must be open to use this command"));
        }
        if (status.json.state == "stopped") {
          return new Notice(t("No video is currently playing"));
        }
        if (this.settings.pauseOnPasteSnapshot) {
          this.sendVlcRequest("pl_forcepause");
        }
        try {
          var beforeReq = Date.now();
          let response = (await this.sendVlcRequest(`snapshot`)) as RequestUrlResponse;
          // .then(async (response: RequestUrlResponse) => {
          if (response.status == 200) {
            var afterReq = Date.now();
            var currentFile = await this.getCurrentVideo();

            var snapshot =
              // @ts-nocheck
              // Object.values(this.app.vault.adapter.files)
              //   .filter((f) => f.type == "file" && f.realpath.startsWith("vlcSnapshots") && f.mtime > beforeReq && f.mtime < afterReq)
              this.app.vault
                .getFiles()
                .filter((f) => f.path.startsWith(`${currentConfig.snapshotFolder || this.settings.snapshotFolder}/`) && f.stat.mtime > beforeReq && f.stat.mtime < afterReq)
                ?.first();
            if (snapshot) {
              var currentStats: vlcStatusResponse = response?.json;

              var timestampLink = await this.getTimestampLink(status);
              var filename = currentStats.information.category.meta.filename;

              var snapshotLinktext = this.settings.snapshotLinktext.replace(/{{filename}}/g, filename).replace(/{{timestamp}}/g, timestampLink.timestamp);
              var snapshotEmbed = `![[${snapshot.path} | ${snapshotLinktext}]]`;
              var templateStr = this.settings.snapshotLinkTemplate
                .replace(/{{timestamplink}}/g, timestampLink.link)
                .replace(/{{snapshot}}/g, snapshotEmbed)
                .replace(/{{filename}}/g, filename)
                .replace(/{{timestamp}}/g, timestampLink.timestamp);

              editor.replaceSelection(templateStr);
              // editor.replaceSelection(`${currentFile ? `${await this.getTimestampLink(response)}` : `${this.secondsToTimestamp(response.json.time)}`}\n![](${snapshot.path})\n`);
            } else {
              new Notice(t("Snapshot not found, if you made a change to the snapshot folder name, try restarting VLC."));
            }
          } else {
            console.log("request error", response.status, response);
          }
          // })
          // .catch((err: Error) => {
          //   console.log("Snapshot error", err);
          // });
        } catch (err) {
          console.log("Snapshot error", err);
        }
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new VBPluginSettingsTab(this.app, this));
  }

  onunload() {}

  setSidebarIcon = () => {
    if (this.settings.showSidebarIcon) {
      this.openVideoIcon = this.addRibbonIcon("lucide-traffic-cone", t("Select a file to open with VLC Player"), (evt: MouseEvent) => {
        this.fileOpen();
      });
    } else {
      this.openVideoIcon?.remove();
    }
  };

  secondsToTimestamp(seconds: number) {
    return new Date(seconds * 1000).toISOString().slice(seconds < 3600 ? 14 : 11, 19);
  }

  getTimestampLink = async (response: RequestUrlResponse) => {
    return new Promise<{ link: string; timestamp: string }>(async (resolve, reject) => {
      var currentStats: vlcStatusResponse = response?.json;
      if (!currentStats) {
        reject();
        return new Notice(t("VLC Player must be open to use this command"));
      }
      var currentFile = await this.getCurrentVideo();
      if (!currentFile) {
        return new Notice(t("No video information available"));
      }

      var params: {
        mediaPath: string;
        timestamp?: string;
        subPath?: string;
        subDelay?: string;
      } = {
        mediaPath: encodeURIComponent(currentFile),
      };

      if (currentMedia.subtitlePath && currentMedia.mediaPath == currentFile) {
        params.subPath = encodeURIComponent(currentMedia.subtitlePath);
      }
      if (typeof currentStats.subtitledelay == "number" && currentStats.subtitledelay !== 0) {
        params.subDelay = currentStats.subtitledelay.toString();
      }

      var currentTimeAsSeconds: number = currentStats.time + this.settings.timestampOffset;
      var timestamp = this.secondsToTimestamp(currentTimeAsSeconds);

      var filename = currentStats.information.category.meta.filename;

      if (this.settings.usePercentagePosition) {
        params.timestamp = `${currentStats.position * 100}%`;
      } else {
        params.timestamp = `${currentTimeAsSeconds}`;
      }

      var paramStr = new URLSearchParams(params).toString();
      var linktext = this.settings.timestampLinktext.replace(/{{timestamp}}/g, timestamp).replace(/{{filename}}/g, filename);
      var timestampLink = `[${linktext}](obsidian://vlcBridge?${paramStr})`;
      // var templateStr = this.settings.timestampLinkTemplate.replace(/{{timestamplink}}/g, timestampLink);
      resolve({ link: timestampLink, timestamp });
    });
  };

  async fileOpen() {
    if (!this.settings.vlcPath) {
      return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
    }
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    input.accept = "video/*, audio/*, .mpd, .flv, .mkv";
    input.onchange = (e: Event) => {
      var files = (e.target as HTMLInputElement)?.files as FileList;
      for (let i = 0; i < files.length; i++) {
        var file = files[i];

        var fileURI = new URL(file.path).href;
        // console.log(fileURI);
        this.openVideo({ mediaPath: fileURI });

        input.remove();
      }
    };

    input.click();
  }

  async subtitleOpen() {
    if (!this.settings.vlcPath) {
      return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
    }
    var mevcutVideo = await this.getCurrentVideo();
    if (!mevcutVideo) {
      return new Notice(t("A video must be open to add subtitles"));
    }
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    // https://wiki.videolan.org/subtitles#Subtitles_support_in_VLC
    let supportedSubtitleFormats = [
      ".aqt",
      ".usf",
      ".txt",
      ".svcd",
      ".sub",
      ".idx",
      ".sub",
      ".sub",
      ".sub",
      ".ssa",
      ".ass",
      ".srt",
      ".smi",
      ".rt",
      ".pjs",
      ".mpl",
      ".jss",
      ".dks",
      ".cvd",
      ".aqt",
      ".ttxt",
      ".ssf",
      ".psb",
    ];
    input.accept = supportedSubtitleFormats.join(",");
    input.onchange = (e: Event) => {
      var files = (e.target as HTMLInputElement)?.files as FileList;
      for (let i = 0; i < files.length; i++) {
        var file = files[i];
        // var fileURI = new URL(file.path).href;
        // console.log(file, file.path, fileURI);
        this.addSubtitle(file.path);

        input.remove();
      }
    };

    input.click();
  }

  async seekFrame(prefix: "-" | "+") {
    try {
      var status = await this.getStatus();
    } catch (error) {
      console.log(error);
      return new Notice(t("VLC Player must be open to use this command"));
    }
    var response: vlcStatusResponse = status.json;
    var length: number = response.length;
    var streams = response.information.category;
    var stream0_key = Object.keys(streams)?.find((key) => {
      // Assume that stream numbered 0 and containing resolution information is video
      return key.includes("0") && Object.values(streams[key]).find((value: string) => value.match(/\d+x\d+/g));
    });
    if (!stream0_key) return;
    var stream0 = streams[stream0_key];

    // Assume that the only number value in the video stream object is fps
    var fps = Number(Object.values(stream0).find((value) => Number(value)));

    // The exact value may not be present because the length is given as an integer instead of exact value
    this.sendVlcRequest(`seek&val=${encodeURI(`${prefix}${100 / (length * fps)}%`)}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
