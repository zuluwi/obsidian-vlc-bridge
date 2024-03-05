import { Editor, MarkdownView, Notice, ObsidianProtocolData, Plugin, RequestUrlResponse } from "obsidian";
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

    const { getStatus, getCurrentVideo, checkPort, sendVlcRequest, openVideo, launchSyncplay, vlcExecOptions, addSubtitle } = passPlugin(this);
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

    this.addCommand({
      id: "paste-video-path-with-timestamp",
      name: t("Paste timestamped link of current video"),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (this.settings.pauseOnPasteLink) {
          this.sendVlcRequest("pl_forcepause");
        }
        let status;
        try {
          status = await this.getStatus();
        } catch (error) {
          console.log(error);
          return new Notice(t("VLC Player must be open to use this command"));
        }
        const timestampLink = await this.getTimestampLink(status);
        const templateStr = this.settings.timestampLinkTemplate.replace(/{{timestamplink}}/g, timestampLink.link);

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
      id: "go-next-frame",
      name: t("Next frame"),
      repeatable: true,
      callback: async () => {
        this.seekFrame("+");
      },
    });

    this.addCommand({
      id: "go-previous-frame",
      name: t("Previous frame"),
      repeatable: true,
      callback: async () => {
        this.seekFrame("-");
      },
    });

    this.addCommand({
      id: "normal-seek-forward",
      name: t("Seek forward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=+${this.settings.normalSeek}`);
      },
    });

    this.addCommand({
      id: "normal-seek-backward",
      name: t("Seek backward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=-${-this.settings.normalSeek}`);
      },
    });
    this.addCommand({
      id: "large-seek-forward",
      name: t("Long seek forward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=+${this.settings.largeSeek}`);
      },
    });

    this.addCommand({
      id: "large-seek-backward",
      name: t("Long seek backward"),
      repeatable: true,
      callback: async () => {
        this.sendVlcRequest(`seek&val=-${-this.settings.largeSeek}`);
      },
    });

    this.addCommand({
      id: "toggle-fullscreen",
      name: t("Toggle fullscreen"),
      callback: async () => {
        this.sendVlcRequest(`fullscreen`);
      },
    });

    this.addCommand({
      id: "toggle-play",
      name: t("Toggle play/pause"),
      callback: async () => {
        this.sendVlcRequest(`pl_pause`);
      },
    });

    this.addCommand({
      id: "paste-snapshot",
      name: t("Take and paste snapshot from video"),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (currentConfig.snapshotFolder && !(await this.app.vault.adapter.exists(currentConfig.snapshotFolder))) {
          this.app.vault.adapter.mkdir(currentConfig.snapshotFolder);
        }
        if (currentConfig.snapshotFolder && currentConfig.snapshotFolder !== this.settings.snapshotFolder) {
          new Notice(t("You must restart VLC for the snapshots to be saved in the folder you set."));
        }
        let status;
        try {
          status = await this.getStatus();
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
          const beforeReq = Date.now();
          const response = (await this.sendVlcRequest(`snapshot`)) as RequestUrlResponse;
          if (response.status == 200) {
            const afterReq = Date.now();

            const snapshot = this.app.vault
              .getFiles()
              .filter((f) => f.path.startsWith(`${currentConfig.snapshotFolder || this.settings.snapshotFolder}/`) && f.stat.mtime > beforeReq && f.stat.mtime < afterReq)
              ?.first();
            if (snapshot) {
              const currentStats: vlcStatusResponse = response?.json;

              const timestampLink = await this.getTimestampLink(status, "snapshot");
              const filename = currentStats.information.category.meta.filename;

              const snapshotLinktext = this.settings.snapshotLinktext.replace(/{{filename}}/g, filename).replace(/{{timestamp}}/g, timestampLink.timestamp);
              const snapshotEmbed = `![[${snapshot.path} | ${snapshotLinktext}]]`;
              const templateStr = this.settings.snapshotLinkTemplate
                .replace(/{{timestamplink}}/g, timestampLink.link)
                .replace(/{{snapshot}}/g, snapshotEmbed)
                .replace(/{{filename}}/g, filename)
                .replace(/{{timestamp}}/g, timestampLink.timestamp);

              editor.replaceSelection(templateStr);
            } else {
              new Notice(t("Snapshot not found, if you made a change to the snapshot folder name, try restarting VLC."));
            }
          } else {
            console.log("request error", response.status, response);
          }
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

  getTimestampLink = (response: RequestUrlResponse, type?: "snapshot" | "timestamp") => {
    return new Promise<{ link: string; timestamp: string }>(async (resolve, reject) => {
      const currentStats: vlcStatusResponse = response?.json;
      if (!currentStats) {
        reject();
        return new Notice(t("VLC Player must be open to use this command"));
      }
      const currentFile = await this.getCurrentVideo();
      if (!currentFile) {
        return new Notice(t("No video information available"));
      }

      const params: {
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

      let currentTimeAsSeconds: number = currentStats.time;
      if (type !== "snapshot") {
        currentTimeAsSeconds = currentTimeAsSeconds + this.settings.timestampOffset;
      }
      const timestamp = this.secondsToTimestamp(currentTimeAsSeconds);

      const filename = currentStats.information.category.meta.filename;

      if (this.settings.usePercentagePosition) {
        params.timestamp = `${currentStats.position * 100}%`;
      } else {
        params.timestamp = `${currentTimeAsSeconds}`;
      }

      const paramStr = new URLSearchParams(params).toString();
      const linktext = this.settings.timestampLinktext.replace(/{{timestamp}}/g, timestamp).replace(/{{filename}}/g, filename);
      const timestampLink = `[${linktext}](obsidian://vlcBridge?${paramStr})`;
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
      const files = (e.target as HTMLInputElement)?.files as FileList;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const fileURI = new URL(file.path).href;
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
    const currentVideo = await this.getCurrentVideo();
    if (!currentVideo) {
      return new Notice(t("A video must be open to add subtitles"));
    }
    const input = document.createElement("input");
    input.setAttribute("type", "file");
    // https://wiki.videolan.org/subtitles#Subtitles_support_in_VLC
    const supportedSubtitleFormats = [
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
      const files = (e.target as HTMLInputElement)?.files as FileList;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        this.addSubtitle(file.path);

        input.remove();
      }
    };

    input.click();
  }

  async seekFrame(prefix: "-" | "+") {
    let status;
    try {
      status = await this.getStatus();
    } catch (error) {
      console.log(error);
      return new Notice(t("VLC Player must be open to use this command"));
    }
    const response: vlcStatusResponse = status.json;
    const length: number = response.length;
    const streams = response.information.category;
    const stream0_key = Object.keys(streams)?.find((key) => {
      // Assume that stream numbered 0 and containing resolution information is video
      return key.includes("0") && Object.values(streams[key]).find((value: string) => value.match(/\d+x\d+/g));
    });
    if (!stream0_key) return;
    const stream0 = streams[stream0_key];

    // Assume that the only number value in the video stream object is fps
    const fps = Number(Object.values(stream0).find((value) => Number(value)));

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
