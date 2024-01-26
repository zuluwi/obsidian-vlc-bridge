import { App, Editor, MarkdownView, Modal, Notice, ObsidianProtocolData, Plugin, PluginSettingTab, RequestUrlResponse, RequestUrlResponsePromise, Setting } from "obsidian";
import { DEFAULT_SETTINGS, VBPluginSettingsTab, VBPluginSettings } from "./settings";
import { passPlugin, currentConfig } from "./vlcHelper";
import { t } from "./language/helpers";

// Remember to rename these classes and interfaces!

export default class VLCBridgePlugin extends Plugin {
  settings: VBPluginSettings;
  openVideo: (filePath: string, time?: number) => void;
  sendVlcRequest: (command: string) => Promise<RequestUrlResponse | undefined>;
  getStatus: () => Promise<RequestUrlResponse>;
  getCurrentVideo: () => Promise<string | null>;
  vlcExecOptions: () => string[];
  async onload() {
    await this.loadSettings();
    var { getStatus, getCurrentVideo, checkPort, sendVlcRequest, openVideo, launchVLC, vlcExecOptions } = passPlugin(this);
    this.openVideo = openVideo;
    this.sendVlcRequest = sendVlcRequest;
    this.getStatus = getStatus;
    this.getCurrentVideo = getCurrentVideo;
    this.vlcExecOptions = vlcExecOptions;

    // This creates an icon in the left ribbon.
    this.addRibbonIcon("lucide-traffic-cone", t("Select a file to open with VLC Player"), (evt: MouseEvent) => {
      this.fileOpen();
    });

    this.registerObsidianProtocolHandler("vlcBridge", (params: ObsidianProtocolData) => {
      var { mediaPath, timestamp } = params;
      if (!mediaPath) {
        return new Notice(t("The link does not have a 'mediaPath' parameter to play"));
      }
      mediaPath = decodeURIComponent(mediaPath);
      var time = Number(timestamp);
      this.openVideo(mediaPath, time);
    });

    this.addCommand({
      id: "paste-video-path-with-timestamp",
      name: t("Paste timestamped link of current video"),
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        if (this.settings.pauseOnPasteLink) {
          this.sendVlcRequest("pl_forcepause");
        }
        var currentStats = await this.getStatus();
        if (!currentStats) {
          return new Notice(t("VLC Player must be open to use this command"));
        }
        var currentFile = await this.getCurrentVideo();
        if (!currentFile) {
          return new Notice(t("No video information available"));
        }
        var currentTime = currentStats.json.time;
        var timestamp = this.secondsToTimestamp(currentTime);
        editor.replaceSelection(`[${timestamp}](obsidian://vlcBridge?mediaPath=${encodeURIComponent(currentFile)}&timestamp=${currentTime}) `);
      },
    });

    this.addCommand({
      id: "open-video-with-vlc",
      name: t("Select a file to open with VLC Player"),
      callback: async () => {
        this.fileOpen();
      },
    });

    // This adds an editor command that can perform some operation on the current editor instance
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
        if ((await this.getStatus()).json.state == "stopped") {
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
                editor.replaceSelection(
                  `${
                    currentFile
                      ? `[${this.secondsToTimestamp(response.json.time)}](obsidian://vlcBridge?mediaPath=${encodeURIComponent(currentFile)}&timestamp=${response.json.time})`
                      : `${this.secondsToTimestamp(response.json.time)}`
                  } ![](${snapshot.path})\n`
                );
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
        // @ts-ignore
        var fileURI = new URL(file.path).href;
        // console.log(fileURI);
        this.openVideo(fileURI);

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
