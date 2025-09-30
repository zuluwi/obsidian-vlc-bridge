import { Editor, ExtraButtonComponent, MarkdownRenderer, MarkdownView, Notice, ObsidianProtocolData, Platform, Plugin, ProgressBarComponent, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, VBPluginSettingsTab, VBPluginSettings } from "./settings";
import { passPlugin, currentConfig, currentMedia, vlcStatusResponse, plObject, vlcRequestResponse } from "./vlcHelper";
import { t } from "./language/helpers";
import extensionList from "./extensionList";
import { fileURLToPath } from "url";
import * as path from "path";
const commandExistsSync = require("command-exists").sync;
import { getSubEntries, ISubEntry, msToTimestamp, supportedSubtitleFormats } from "./subtitleParser";
import { IDialogEntry, ITranscriptViewState, TranscriptView, VIEW_TYPE_VB } from "./transcriptView";

declare global {
  interface File {
    readonly path: string;
  }
}

export default class VLCBridgePlugin extends Plugin {
  settings: VBPluginSettings;
  openVideo: (params: ObsidianProtocolData | { mediaPath: string; subPath?: string; subDelay?: string; timestamp?: string; pause?: boolean }) => Promise<Notice | undefined>;
  addSubtitle: (filePath: string, subDelay?: string) => void;
  sendVlcRequest: (command: string) => Promise<vlcRequestResponse | undefined>;
  getStatus: () => Promise<vlcStatusResponse | undefined>;
  checkPort: (timeout?: number) => Promise<object | null>;
  getCurrentVideo: () => Promise<plObject | null>;
  vlcExecOptions: (type: "syncplay" | "vlc") => string[];
  launchSyncplay: () => void;
  getLength: (params: {
    mediaPath?: string | null;
    dontBackCurrentPos?: boolean;
    onlyGetLength?: boolean;
  }) => Promise<{ length: number; currentPos?: number; currentPosAsMs?: number; status?: vlcStatusResponse } | undefined>;
  cliExist: null | "vlc";
  spCliExist: null | "syncplay";

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_VB, (leaf) => new TranscriptView(leaf, this));

    const { getStatus, getCurrentVideo, checkPort, sendVlcRequest, openVideo, launchSyncplay, vlcExecOptions, addSubtitle, getLength } = passPlugin(this);
    this.openVideo = openVideo;
    this.addSubtitle = addSubtitle;
    this.sendVlcRequest = sendVlcRequest;
    this.getStatus = getStatus;
    this.checkPort = checkPort;
    this.getCurrentVideo = getCurrentVideo;
    this.vlcExecOptions = vlcExecOptions;
    this.launchSyncplay = launchSyncplay;
    this.getLength = getLength;

    // Check command-lines
    if (commandExistsSync("vlc")) {
      this.cliExist = "vlc";
    } else {
      this.settings.commandPath = "vlcPath";
    }
    if (commandExistsSync("syncplay")) {
      this.spCliExist = "syncplay";
    } else {
      this.settings.spCommandPath = "spPath";
    }

    this.registerObsidianProtocolHandler("vlcBridge", (params: ObsidianProtocolData) => {
      this.openVideo(params);
    });

    this.registerObsidianProtocolHandler("vlcBridge-runSyncplay", () => {
      this.launchSyncplay();
    });

    this.addRibbonIcon("lucide-traffic-cone", t("Select a file to open with VLC Player"), (evt: MouseEvent) => {
      this.fileOpen();
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source, leaf) => {
        if (!(file instanceof TFile) || !this.cliExist || !this.settings.vlcPath) return;
        const mediaExts = [...extensionList.video, ...extensionList.audio];
        if (mediaExts.includes(file.extension)) {
          menu
            .addItem((item) => {
              item
                .setIcon("lucide-traffic-cone")
                .setTitle(t("Open with VLC Player"))
                .onClick(() => {
                  const filePath = this.app.vault.adapter.getFullRealPath(file.path);
                  this.openVideo({ mediaPath: filePath });
                });
            })
            .addSeparator();
        }
      })
    );

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
          if (!status) {
            return new Notice(t("VLC Player must be open to use this command"));
          }
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
      id: "open-transcript-view",
      icon: "lucide-captions",
      name: t("Open transcript view"),
      callback: async () => {
        const currentSub = await this.checkSubtitles();
        if (!currentSub) {
          return;
        } else {
          const subExt = path.extname(currentSub.currentMedia.subtitlePath as string);
          if (!supportedSubtitleFormats.includes(subExt)) {
            return new Notice(`${t("Unsupported subtitle extension")}: ${subExt}`);
          }
          const lengthInfo = await this.getLength({ mediaPath: currentMedia.mediaPath });
          if (lengthInfo?.status) {
            this.activateView(
              lengthInfo.length,
              currentMedia.subtitlePath as string,
              currentMedia.mediaPath as string,
              path.basename(currentSub.currentFile.uri),
              // .replaceAll("[", "［") // prevent wikilinks
              // .replaceAll("]", "］"),
              lengthInfo.status.subtitledelay
            );
          }
        }
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
        const templateStr = (await this.getSnapshot({}))?.templateStr;
        if (templateStr) {
          editor.replaceSelection(templateStr);
        }
      },
    });

    // This adds a settings tab so the user can configure various aspects of the plugin
    this.addSettingTab(new VBPluginSettingsTab(this.app, this));
  }

  onunload() {
    // const { workspace } = this.app;
    // const leaves = workspace.getLeavesOfType(VIEW_TYPE_VB);
    // leaves.forEach((leaf) => {
    // leaf.detach();
    // });
  }

  async checkSubtitles() {
    if (!currentMedia.subtitlePath) {
      new Notice(
        t("Subtitles could not be detected. If you receive this error even if the playing video has subtitles, please add subtitles again using the “Add subtitles” command."),
        30 * 1000
      );
      return null;
    }
    const currentFile = await this.getCurrentVideo();
    if (!currentFile) {
      new Notice(t("No video information available"));
      return null;
    }

    if (currentFile.uri !== currentMedia.mediaPath) {
      currentMedia.mediaPath = null;
      currentMedia.subtitlePath = null;
      return null;
    }

    return { currentMedia, currentFile };
  }

  async getSubWithSnapshots(params: {
    parsingParams?: { subPath: string; mediaPath: string; type: "current" | "all" };
    parsedEntries?: { entries: IDialogEntry[] | ISubEntry[] | null; filename: string; length: number; subPath: string; mediaPath: string; subDelay?: number | null };
  }) {
    const beforeProcess = Date.now();
    let length: number | undefined;
    let status: vlcStatusResponse | undefined;
    if (params.parsedEntries?.length) {
      length = params.parsedEntries.length;
      status = await this.getStatus();
    } else {
      const lengthRes = await this.getLength({ mediaPath: params?.parsingParams?.mediaPath || params.parsedEntries?.mediaPath });
      length = lengthRes?.length;
      status = lengthRes?.status;
    }
    if (!(length && status && status.position)) {
      new Notice(t("Failed to take a snapshot for transcript"));
      return;
    }
    const currentFilename = status.information.category.meta.filename;
    // let lastPosition;
    if (params.parsedEntries?.filename && params.parsedEntries?.filename !== currentFilename) {
      new Notice(t("Different video is now playing. To take a snapshot, open the video with the copied subtitles."));
      return;
      // let { subPath, mediaPath, subDelay } = params.parsedEntries;
      // lastPosition = await this.getTimestampLink(status);
      // await this.openVideo({ mediaPath, subPath, subDelay: subDelay?.toString() });
      // status = (await this.getStatus()) as vlcStatusResponse;
      // currentFilename = status.information.category.meta.filename;
    }

    let subEntries: IDialogEntry[] | ISubEntry[] | null | undefined;
    if (params.parsingParams) {
      const { subPath, mediaPath, type } = params.parsingParams;
      subEntries = getSubEntries({
        length: { length: length, currentPos: type == "current" ? status.position : null },
        mediaPath: mediaPath,
        subPath: subPath,
        subDelay: status.subtitledelay == 0 ? null : status.subtitledelay,
        template: this.settings.transcriptTemplate,
      });
    } else {
      subEntries = params.parsedEntries?.entries;
    }

    const snapshotPlaceholder = "{{snapshot}}";
    const newSubEntries: string[] = [];
    let formattedStr: string;
    if (subEntries?.length && this.settings.transcriptTemplate.includes(snapshotPlaceholder)) {
      let continueToSnapshot = true;

      const finishingTimes: number[] = [];
      const average = (array: number[]) => array.reduce((a, b) => a + b) / array.length;
      const progressNotice = new Notice(`0/${subEntries.length}`, 0);

      progressNotice.hide = () => {
        // prevent closing on click
      };
      const progressBar = new ProgressBarComponent(progressNotice.containerEl);
      const noticeBtnEl = progressNotice.containerEl.createDiv({ cls: "vlc-bridge-subtitle-notice-options" });
      const stopBtn = new ExtraButtonComponent(noticeBtnEl)
        .setIcon("octagon-pause")
        .setTooltip(t("Stop process"))
        .onClick(() => {
          continueToSnapshot = false;
          stopBtn.extraSettingsEl.hide();
        });
      new ExtraButtonComponent(noticeBtnEl)
        .setIcon("cross")
        .setTooltip(t("Close"))
        .onClick(() => {
          continueToSnapshot = false;
          progressNotice.containerEl.hide();
        });

      for (let i = 0; i < subEntries.length; i++) {
        const startTime = Date.now();

        if (continueToSnapshot) {
          const entry = subEntries[i];
          let snapshot;
          const middleAsMs = Math.round((entry.from + entry.to) / 2);
          const timestampMs = this.settings.jumpMiddleOfDialog ? middleAsMs : entry.from;
          const isSnapshotAlreadyExist = this.findExistingSnapshot(
            currentFilename
              .replaceAll("[", "［") // prevent wikilinks
              .replaceAll("]", "］"),
            timestampMs,
            entry.from,
            entry.to
          )?.[0];
          if (isSnapshotAlreadyExist) {
            snapshot = isSnapshotAlreadyExist;
          } else {
            // const posMiddle = ((entry.posFrom + entry.posTo) / 2) * 100;
            const posMiddle = (middleAsMs / (length * 1000)) * 100;
            const timestampPos = this.settings.jumpMiddleOfDialog ? posMiddle : entry.posFrom * 100;
            snapshot = await this.getSnapshot({ timestamp: timestampPos, originalFilename: currentFilename, milliseconds: timestampMs });
          }

          if (snapshot) {
            newSubEntries.push(entry.formattedStr.replaceAll(snapshotPlaceholder, snapshot.snapshotEmbed));

            if (!isSnapshotAlreadyExist) {
              const endTime = Date.now() - startTime;
              finishingTimes.push(endTime);
            }
            if (Object.prototype.hasOwnProperty.call(entry, "getDialogView")) {
              (entry as IDialogEntry).getDialogView(false);
            }
            progressBar.setValue(((i + 1) / subEntries.length) * 100);
            progressNotice.setMessage(
              createFragment((el) => {
                MarkdownRenderer.render(
                  this.app,
                  `#### ${currentFilename}\n` +
                    `\`${newSubEntries.length}/${(subEntries as IDialogEntry[]).length}\` ${t("snapshots were taken")}\n` +
                    `${t("Elapsed time")}:  \`${msToTimestamp(Date.now() - beforeProcess).simplified}\`\n` +
                    `${t("Remaining time")}: \`${
                      msToTimestamp(average(finishingTimes.length > 0 ? finishingTimes : [0]) * ((subEntries as IDialogEntry[]).length - 1 - i)).simplified
                    }\``,
                  el.createDiv(),
                  "",
                  this
                );
              })
            );
          } else {
            continueToSnapshot = false;
          }
        }
      }
      progressNotice.setMessage(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `#### ${currentFilename}\n` +
              `\`${newSubEntries.length}/${(subEntries as IDialogEntry[]).length}\` ${t("snapshots were taken")}\n` +
              `${t("Elapsed time")}:  \`${this.secondsToTimestamp(Math.round((Date.now() - beforeProcess) / 1000))}\`\n`,
            el.createDiv(),
            "",
            this
          );
        })
      );
      const copyBtn = new ExtraButtonComponent(progressNotice.containerEl)
        .setIcon("copy")
        .setTooltip(t("Copy to clipboard"))
        .onClick(async () => {
          if (formattedStr) {
            await navigator.clipboard.writeText(formattedStr);
            new Notice(t("Copied to clipboard"));
          }
        });
      stopBtn.extraSettingsEl.hide();
      noticeBtnEl.prepend(copyBtn.extraSettingsEl);
    }

    if (newSubEntries.length > 0) {
      formattedStr = newSubEntries?.join("\n\n");
    } else {
      formattedStr = subEntries?.map((e) => e.formattedStr).join("\n\n") || "";
    }
    // if (lastPosition) {
    //   await this.openVideo(lastPosition.params);
    //   this.sendVlcRequest("pl_forcepause");
    // } else {
    this.sendVlcRequest(`seek&val=${status.position * 100}%25`);
    // }
    return formattedStr;
  }

  async activateView(length: number, subPath: string, mediaPath: string, title: string, subDelay?: number) {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    leaf = workspace.getLeaf("split", "vertical");
    const tsViewState: ITranscriptViewState = {
      length: length,
      subPath: subPath,
      subDelay: subDelay || null,
      mediaPath: mediaPath,
      title: title,
    };
    await leaf.setViewState({ type: VIEW_TYPE_VB, active: true }, tsViewState);

    workspace.revealLeaf(leaf);
  }

  getSnapshot = async (params: { timestamp?: number; originalFilename?: string; milliseconds?: number }) => {
    const { timestamp, originalFilename, milliseconds } = params;
    // let length:
    //   | {
    //       length: number;
    //       currentPos: number;
    //       currentPosAsMs: number;
    //       status: vlcStatusResponse;
    //     }
    //   | undefined;
    const timestampStr = `${timestamp}%25`;
    if (currentConfig.snapshotFolder && !(await this.app.vault.adapter.exists(currentConfig.snapshotFolder))) {
      this.app.vault.adapter.mkdir(currentConfig.snapshotFolder);
    }
    if (currentConfig.snapshotFolder && currentConfig.snapshotFolder !== this.settings.snapshotFolder) {
      new Notice(t("You must restart VLC for the snapshots to be saved in the folder you set."));
      return null;
    }
    let status: vlcStatusResponse | undefined;
    try {
      if (timestamp) {
        status = (await this.sendVlcRequest(`seek&val=${timestampStr}`))?.json;
        if (status?.state == "stopped") {
          await this.sendVlcRequest("pl_pause");
          status = (await this.sendVlcRequest(`seek&val=${timestampStr}`))?.json;
          await this.sendVlcRequest("pl_forcepause");
        }
      } else {
        // if (!milliseconds) {
        //   length = await this.getLength();
        //   status = length?.status;
        // } else {
        status = await this.getStatus();
        // }
      }
      if (!status) {
        new Notice(t("VLC Player must be open to use this command"));
        return null;
      }
    } catch (error) {
      console.log(error);
      new Notice(t("VLC Player must be open to use this command"));
      return null;
    }
    if (originalFilename && originalFilename !== status.information.category.meta.filename) {
      new Notice(t("Different video is now playing. To take a snapshot, open the video with the copied subtitles."));
      return null;
    }
    if (status.state == "stopped") {
      new Notice(t("No video is currently playing"));
      return null;
    }
    if (this.settings.pauseOnPasteSnapshot && status.state !== "paused") {
      await this.sendVlcRequest("pl_forcepause");
    }

    // await sleep(200);

    if (timestamp) {
      return await this.takeSnapshot({ type: "loop", tryCount: 1, milliseconds });
    } else {
      return await this.takeSnapshot({ type: "single" });
    }
  };
  takeSnapshot = async (params: {
    type: "loop" | "single";
    // filename: string;
    milliseconds?: number;
    tryCount?: number;
  }): Promise<{ templateStr: string; snapshotEmbed: string } | null> => {
    let { type, tryCount, milliseconds } = params;
    const tryTimeForSubtitleExport = 4;
    try {
      const beforeReq = Date.now();
      const response = await this.sendVlcRequest(`snapshot`);
      if (response?.status !== 200) {
        console.log("request error", response?.status, response);
        return null;
      }
      const afterReq = Date.now();

      const snapshot = await this.findSnapshotFile(beforeReq, afterReq);
      if (snapshot) {
        if (!milliseconds) {
          const length = await this.getLength({});
          milliseconds = Math.round((length?.length as number) * response.json.position * 1000);
        }
        const timestampLink = await this.getTimestampLink(response.json, "snapshot");
        const filename = response.json.information.category.meta.filename
          .replaceAll("[", "［") // prevent wikilinks
          .replaceAll("]", "］");
        await this.editSnapshotFile(snapshot, filename, milliseconds);
        const snapshotEmbed = this.formatSnapshotEmbed(snapshot, filename, timestampLink.timestamp);
        const templateStr = this.settings.snapshotLinkTemplate
          .replace(/{{timestamplink}}/g, timestampLink.link)
          .replace(/{{snapshot}}/g, snapshotEmbed)
          .replace(/{{filename}}/g, filename)
          .replace(/{{timestamp}}/g, timestampLink.timestamp);

        this.app.workspace.getLeavesOfType(VIEW_TYPE_VB).forEach((leaf) => {
          if (leaf.view instanceof TranscriptView && leaf.view.mediaPath == decodeURIComponent(timestampLink.params.mediaPath)) {
            const dialogForSnapshot = leaf.view.dialogsView.find((e, i, arr) =>
              e.from <= (milliseconds as number) && i + 1 < arr.length ? (milliseconds as number) < arr[i + 1]?.from : true
            );
            if (dialogForSnapshot) {
              dialogForSnapshot.getDialogView(true);
            }
          }
        });

        return { templateStr, snapshotEmbed };
      } else {
        if (type == "loop" && tryCount && tryCount <= tryTimeForSubtitleExport) {
          return this.takeSnapshot({ type: "loop", milliseconds, tryCount: ++tryCount });
        } else {
          new Notice(t("Snapshot not found, if you made a change to the snapshot folder name, try restarting VLC."));
          return null;
        }
      }
    } catch (err) {
      console.log("Snapshot error", err);
      return null;
    }
  };
  findSnapshotFile = (beforeReq: number, afterReq: number) => {
    return new Promise<TFile | undefined>((res, rej) => {
      const findSnapshot = () => {
        return this.app.vault
          .getFiles()
          .find((f) => f.path.startsWith(`${currentConfig.snapshotFolder || this.settings.snapshotFolder}`) && f.stat.ctime > beforeReq && f.stat.ctime < afterReq);
        // .filter((f) => f.path.startsWith(`${currentConfig.snapshotFolder || this.settings.snapshotFolder}`) && f.stat.ctime > beforeReq && f.stat.ctime < afterReq)
        // ?.first();
      };

      let snapshot: TFile | undefined;
      snapshot = findSnapshot();

      if (snapshot) {
        res(snapshot);
      } else {
        let checkSnapshotInterval: number | undefined; //NodeJS.Timer | undefined;
        let checkSnapshotTimeout: NodeJS.Timeout;

        checkSnapshotInterval = window.setInterval(() => {
          snapshot = findSnapshot();

          if (snapshot) {
            checkSnapshotInterval = clearInterval(checkSnapshotInterval) as undefined;
            clearTimeout(checkSnapshotTimeout);
            res(snapshot);
          }
        }, 100);
        this.registerInterval(checkSnapshotInterval);

        checkSnapshotTimeout = setTimeout(() => {
          if (checkSnapshotInterval) {
            checkSnapshotInterval = clearInterval(checkSnapshotInterval) as undefined;
            res(snapshot);
          }
        }, 1000);
      }
    });
  };
  editSnapshotFile = async (snapshotFile: TFile, filename: string, milliseconds: number) => {
    const snapshotFolderForCurrentMedia = `${this.settings.snapshotFolder}/${filename}`;
    const folderExist = this.app.vault.getFolderByPath(snapshotFolderForCurrentMedia);
    if (!folderExist) {
      await this.app.vault.adapter.mkdir(snapshotFolderForCurrentMedia);
    }
    const newPath = this.formatSnapshotPath(filename, milliseconds);
    const newPathWithExt = `${newPath.fullstr}.${snapshotFile.extension}`;
    try {
      await this.app.fileManager.renameFile(snapshotFile, newPathWithExt);
    } catch (error) {
      const alreadyExist = this.app.vault.getFileByPath(newPathWithExt);
      if (alreadyExist) {
        await this.app.fileManager.trashFile(alreadyExist);
        await this.app.fileManager.renameFile(snapshotFile, newPathWithExt);
      } else {
        console.error(error);
      }
    }
  };
  formatSnapshotPath = (filename: string, milliseconds: number) => {
    const timestamp = msToTimestamp(milliseconds);
    const folder = `${this.settings.snapshotFolder}/${filename}`;
    const newFilename = `snapshot-${filename}-${timestamp.hh}h${timestamp.mm}m${timestamp.ss}s${timestamp.ms}`;

    const result = {
      folder,
      filename: newFilename,
      fullstr: `${folder}/${newFilename}`,
    };
    return result;
  };
  snapshotPathToMs = (path: string) => {
    const regex = new RegExp(`snapshot-(?<filename>.*)-(?<hh>\\d+)h(?<mm>\\d+)m(?<ss>\\d+)s(?<ms>\\d{3})`, "gi");
    const matches = [...path.matchAll(regex)][0];

    if (matches && matches.groups) {
      let milliseconds = 0;
      const hh = Number(matches.groups.hh);
      milliseconds += hh * 60 * 60 * 1000;
      const mm = Number(matches.groups.mm);
      milliseconds += mm * 60 * 1000;
      const ss = Number(matches.groups.ss);
      milliseconds += ss * 1000;
      const ms = Number(matches.groups.ms);
      milliseconds += ms;

      const result = {
        milliseconds,
        timestamp: msToTimestamp(milliseconds).simplifiedWithoutMs,
        filename: matches.groups.filename,
      };
      return result;
    }
    return null;
  };
  formatSnapshotEmbed = (snapshotFile: TFile, filename: string, timestampCode: string) => {
    const snapshotLinkpath = this.app.metadataCache.fileToLinktext(snapshotFile, "/");
    const snapshotLinktext = this.settings.snapshotLinktext.replace(/{{filename}}/g, filename).replace(/{{timestamp}}/g, timestampCode);
    const snapshotEmbed = `![[${snapshotLinkpath} | ${snapshotLinktext}]]`;
    return snapshotEmbed;
  };

  /**
   * @param exactPosition as milliseconds
   */
  findExistingSnapshot = (filename: string, exactPosition: number, rangeFrom: number, rangeTo: number, getAllRange?: boolean, allFiles?: TFile[]) => {
    if (!allFiles) {
      allFiles = this.app.vault.getFiles();
    }
    if (!getAllRange) {
      const path = this.formatSnapshotPath(filename, exactPosition);
      const existingSnapshot = allFiles.find((f) => f.path.startsWith(path.fullstr));
      if (existingSnapshot) {
        const snapshotEmbed = this.formatSnapshotEmbed(existingSnapshot, filename, msToTimestamp(exactPosition).fullString);
        return [{ existingSnapshot, snapshotEmbed }];
      }
    } else {
      const snapshotPath = `${this.settings.snapshotFolder}/${filename}/`;
      const snapshotsInRange: { file: TFile; timestamp: number }[] = [];
      allFiles.forEach((file) => {
        if (!file.path.startsWith(snapshotPath)) {
          return;
        }
        const timestampFromPath = this.snapshotPathToMs(file.path.substring(snapshotPath.length))?.milliseconds;

        if (timestampFromPath && timestampFromPath >= rangeFrom && timestampFromPath < rangeTo) {
          snapshotsInRange.push({
            file,
            timestamp: timestampFromPath,
          });
        }
      });
      if (snapshotsInRange.length) {
        snapshotsInRange.sort((a, b) => a.timestamp - b.timestamp);

        return snapshotsInRange.map((snapshot) => {
          return {
            existingSnapshot: snapshot.file,
            snapshotEmbed: this.formatSnapshotEmbed(snapshot.file, filename, msToTimestamp(snapshot.timestamp).fullString),
          };
        });
      }
    }
    return null;
  };

  secondsToTimestamp(seconds: number) {
    return new Date(seconds * 1000).toISOString().slice(seconds < 3600 ? 14 : 11, 19);
  }

  getTimestampLink = (response: vlcStatusResponse, type?: "snapshot" | "timestamp") => {
    return new Promise<{
      link: string;
      timestamp: string;
      params: {
        mediaPath: string;
        subPath?: string;
        subDelay?: string;
        timestamp?: string;
      };
    }>(async (resolve, reject) => {
      const currentStatus: vlcStatusResponse = response;
      if (!currentStatus) {
        reject();
        return new Notice(t("VLC Player must be open to use this command"));
      }
      const currentFile = (await this.getCurrentVideo())?.uri;
      if (!currentFile) {
        return new Notice(t("No video information available"));
      }

      const params: {
        mediaPath: string;
        subPath?: string;
        subDelay?: string;
        timestamp?: string;
      } = {
        mediaPath: encodeURIComponent(currentFile),
      };

      if (currentMedia.subtitlePath && currentMedia.mediaPath == currentFile) {
        params.subPath = encodeURIComponent(currentMedia.subtitlePath);
      }
      if (typeof currentStatus.subtitledelay == "number" && currentStatus.subtitledelay !== 0) {
        params.subDelay = currentStatus.subtitledelay.toString();
      }

      let currentTimeAsSeconds: number = currentStatus.time;
      if (type !== "snapshot") {
        currentTimeAsSeconds = currentTimeAsSeconds + this.settings.timestampOffset;
      }
      const timestamp = msToTimestamp(currentTimeAsSeconds * 1000);

      const filename = currentStatus.information.category.meta.filename
        .replaceAll("[", "［") // prevent wikilinks
        .replaceAll("]", "］");

      if (this.settings.usePercentagePosition) {
        params.timestamp = `${currentStatus.position * 100}%`;
      } else {
        params.timestamp = `${currentTimeAsSeconds}`;
      }

      const paramStr = new URLSearchParams(params).toString();
      const linktext = this.settings.timestampLinktext.replace(/{{timestamp}}/g, timestamp.simplifiedWithoutMs).replace(/{{filename}}/g, filename);
      const timestampLink = `[${linktext}](obsidian://vlcBridge?${paramStr})`;
      resolve({ link: timestampLink, timestamp: timestamp.simplifiedWithoutMs, params });
    });
  };

  async fileOpen() {
    if (!(this.cliExist || this.settings.vlcPath)) {
      if (Platform.isWin) {
        return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
      } else {
        return new Notice(t("To use the plugin, the ‘vlc’ command must be installed on your system."));
      }
    }

    window.electron.remote.dialog
      .showOpenDialog({
        title: t("Select a file to open with VLC Player"),
        properties: ["openFile"],
        filters: [
          {
            name: "Media",
            extensions: [...extensionList.audio, ...extensionList.video],
          },
        ],
      })
      .then(async (result: { canceled: boolean; filePaths: string[] }) => {
        if (!result.canceled && result.filePaths.length) {
          const file = result.filePaths[0];
          const fileURI = new URL(file).href;
          console.log(result, fileURI);

          this.openVideo({ mediaPath: fileURI });
        }
      })
      .catch((err: Error) => {
        console.log(err);
      });
  }

  async subtitleOpen() {
    if (!(this.settings.vlcPath || this.cliExist)) {
      if (Platform.isWin) {
        return new Notice(t("Before you can use the plugin, you need to select 'vlc.exe' in the plugin settings"));
      } else {
        return new Notice(t("To use the plugin, the ‘vlc’ command must be installed on your system."));
      }
    }
    const currentVideo = (await this.getCurrentVideo())?.uri;
    if (!currentVideo) {
      return new Notice(t("A video must be open to add subtitles"));
    }

    window.electron.remote.dialog
      .showOpenDialog({
        title: t("Add subtitles"),
        properties: ["openFile"],
        defaultPath: path.dirname(fileURLToPath(currentVideo)),
        filters: [
          {
            name: "Subtitle",
            extensions: extensionList.subtitle,
          },
        ],
      })
      .then(async (result: { canceled: boolean; filePaths: string[] }) => {
        if (!result.canceled && result.filePaths.length) {
          const file = result.filePaths[0];
          console.log(result);

          this.addSubtitle(file);
        }
      })
      .catch((err: Error) => {
        console.log(err);
      });
  }

  async seekFrame(prefix: "-" | "+") {
    let lenghtRes;
    try {
      const mediaPath = (await this.getCurrentVideo())?.uri;
      lenghtRes = await this.getLength({ mediaPath });
      if (!(lenghtRes && lenghtRes.status)) {
        return new Notice(t("VLC Player must be open to use this command"));
      }
    } catch (error) {
      console.log(error);
      return new Notice(t("VLC Player must be open to use this command"));
    }
    const response = lenghtRes.status;
    const length: number = lenghtRes.length;
    // const response = status;
    // const length: number = response.length;
    const streams = response.information.category;
    const stream0_key = Object.keys(streams)?.find((key) => {
      // Assume that stream numbered 0 and containing resolution information is video
      return key.includes("0") && Object.values(streams[key]).find((value: string) => value.match(/\d+x\d+/g));
    });
    if (!stream0_key) return;
    const stream0 = streams[stream0_key];

    // Assume that the only number value in the video stream object is fps
    const fps = Number(Object.values(stream0).find((value) => Number(value)));

    //// The exact value may not be present because the length is given as an integer instead of exact value
    this.sendVlcRequest(`seek&val=${encodeURI(`${prefix}${100 / (length * fps)}%`)}`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
const sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, ms);
  });
};
