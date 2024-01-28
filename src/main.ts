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
  openVideo: ({ filePath, subPath, subDelay, time }: { filePath: string; subPath?: string; subDelay?: number; time?: number }) => void;
  addSubtitle: (filePath: string, subDelay?: number) => void;
  sendVlcRequest: (command: string) => Promise<RequestUrlResponse | undefined>;
  getStatus: () => Promise<RequestUrlResponse>;
  checkPort: (timeout?: number) => Promise<object | null>;
  getCurrentVideo: () => Promise<string | null>;
  vlcExecOptions: () => string[];

  async onload() {
    await this.loadSettings();
    var { getStatus, getCurrentVideo, checkPort, sendVlcRequest, openVideo, launchVLC, vlcExecOptions, addSubtitle } = passPlugin(this);
    this.openVideo = openVideo;
    this.addSubtitle = addSubtitle;
    this.sendVlcRequest = sendVlcRequest;
    this.getStatus = getStatus;
    this.checkPort = checkPort;
    this.getCurrentVideo = getCurrentVideo;
    this.vlcExecOptions = vlcExecOptions;

    // This creates an icon in the left ribbon.
    this.addRibbonIcon("lucide-traffic-cone", t("Select a file to open with VLC Player"), (evt: MouseEvent) => {
      this.fileOpen();
    });

    this.registerObsidianProtocolHandler("vlcBridge", (params: ObsidianProtocolData) => {
      var { mediaPath, subPath, subDelay, timestamp } = params;
      if (!mediaPath) {
        return new Notice(t("The link does not have a 'mediaPath' parameter to play"));
      }
      mediaPath = decodeURIComponent(mediaPath);
      var openParams: { filePath: string; subPath?: string; subDelay?: number; time?: number } = { filePath: mediaPath };
      if (timestamp) {
        openParams.time = Number(timestamp);
      }
      if (subPath) {
        openParams.subPath = decodeURIComponent(subPath);
      }
      if (subDelay) {
        openParams.subDelay = Number(subDelay);
      }

      this.openVideo(openParams);
    });

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
        editor.replaceSelection(`${await this.getTimestampLink(status)} `);
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
      id: "add-subtitle",
      icon: "lucide-subtitles",
      name: t("Add subtitles (if you want subtitle path in the timestamp link, you need to add them with this command)"),
      callback: async () => {
        this.subtitleOpen();
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
      id: "vlc-toggle-play",
      name: t("Toggle play/pause"),
      // editorCallback: (editor: Editor, view: MarkdownView) => {
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
        var beforeReq = Date.now();
        this.sendVlcRequest(`snapshot`)
          .then(async (response: RequestUrlResponse) => {
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
                editor.replaceSelection(`${currentFile ? `${await this.getTimestampLink(response)}` : `${this.secondsToTimestamp(response.json.time)}`}\n![](${snapshot.path})\n`);
              } else {
                new Notice(t("Snapshot not found, if you made a change to the snapshot folder name, try restarting VLC."));
              }
            } else {
              console.log("request error", response.status, response);
            }
          })
          .catch((err: Error) => {
            console.log("Snapshot error", err);
          });
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new VBPluginSettingsTab(this.app, this));
  }

  onunload() {}
  secondsToTimestamp(seconds: number) {
    return new Date(seconds * 1000).toISOString().slice(seconds < 3600 ? 14 : 11, 19);
  }

  getTimestampLink = async (response: RequestUrlResponse) => {
    return new Promise<string>(async (resolve, reject) => {
      var currentStats: vlcStatusResponse = response?.json;
      if (!currentStats) {
        reject();
        return new Notice(t("VLC Player must be open to use this command"));
      }
      var currentFile = await this.getCurrentVideo();
      if (!currentFile) {
        return new Notice(t("No video information available"));
      }
      var currentTime: number = currentStats.time;
      var timestamp = this.secondsToTimestamp(currentTime);
      var params: {
        mediaPath: string;
        timestamp: string;
        subPath?: string;
        subDelay?: string;
      } = {
        mediaPath: encodeURIComponent(currentFile),
        timestamp: currentTime.toString(),
      };

      if (currentMedia.subtitlePath && currentMedia.mediaPath == currentFile) {
        params.subPath = encodeURIComponent(currentMedia.subtitlePath);
      }
      if (typeof currentStats.subtitledelay == "number" && currentStats.subtitledelay !== 0) {
        params.subDelay = currentStats.subtitledelay.toString();
      }
      var paramStr = new URLSearchParams(params).toString();
      resolve(`[${timestamp}](obsidian://vlcBridge?${paramStr})`);
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
        this.openVideo({ filePath: fileURI });

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
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
