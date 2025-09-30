import {
  ExtraButtonComponent,
  IconName,
  ItemView,
  MarkdownRenderer,
  Menu,
  normalizePath,
  Notice,
  Platform,
  SearchComponent,
  setTooltip,
  TFile,
  ToggleComponent,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import { formatSubText, getSubEntries, ISubEntry } from "./subtitleParser";
import VLCBridgePlugin from "./main";
import * as path from "path";
import { t } from "./language/helpers";

declare module "obsidian" {
  interface App {
    internalPlugins: {
      getEnabledPluginById: (arg: string) => {
        revealInFolder: (file: TFile) => void;
      };
    };
    showInFolder: (path: string) => void;
    openWithDefaultApp: (path: string) => void;
  }
  interface DataAdapter {
    basePath: string;
  }
}

export const VIEW_TYPE_VB = "vlc-bridge-transcript";

export interface ITranscriptViewState {
  length: number;
  subPath: string;
  subDelay: number | null;
  mediaPath: string;
  title: string;
}

export interface IDialogEntry extends ISubEntry {
  checkbox: ToggleComponent;
  // copyBtn: ExtraButtonComponent;
  dialogEl: HTMLDivElement;
  dialogTextEl: HTMLDivElement;
  getDialogView: (reload: boolean, snapshotFiles?: TFile[]) => void;
  setRangeBtn: ExtraButtonComponent;
  rangeMarker: string | null;
}

export class TranscriptView extends ItemView {
  plugin: VLCBridgePlugin;
  transcriptEl: HTMLDivElement;
  optionsEl: HTMLDivElement;
  searchMatches: { matchedRegex: RegExp | null; spanArr: HTMLSpanElement[] };
  searchRegex: RegExp;
  followingInterval: number | null; //ReturnType<typeof setInterval> | null;
  followAndScroll: boolean;

  length: number;
  subPath: string;
  subDelay: number | null;
  mediaPath: string;
  title: string;

  dialogsView: IDialogEntry[];
  constructor(leaf: WorkspaceLeaf, plugin: VLCBridgePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.searchMatches = { matchedRegex: null, spanArr: [] };
    this.setActions();
  }
  setState(state: ITranscriptViewState, result: ViewStateResult): Promise<void> {
    const { length, subPath, subDelay, mediaPath, title } = state;

    if (length && subPath && mediaPath && title) {
      this.length = length;
      this.subPath = subPath;
      this.subDelay = subDelay;
      this.mediaPath = mediaPath;
      this.title = title;
      this.createView();
    }
    return super.setState(state, result);
  }
  setEphemeralState(state: ITranscriptViewState): void {
    const { length, subPath, subDelay, mediaPath, title } = state;
    if (length && subPath && mediaPath && title) {
      this.length = length;
      this.subPath = subPath;
      this.subDelay = subDelay;
      this.mediaPath = mediaPath;
      this.title = title;

      this.createView();
    }
    // return super.setEphemeralState(state);
  }

  getState() {
    if (this.plugin.settings.keepTranscriptViews) {
      return {
        length: this.length,
        subPath: this.subPath,
        subDelay: this.subDelay,
        mediaPath: this.mediaPath,
        title: this.title,
      };
    } else {
      return super.getState();
    }
  }

  getIcon(): IconName {
    return "lucide-captions";
  }

  getViewType() {
    return VIEW_TYPE_VB;
  }

  getDisplayText() {
    // return this.title ? `${path.parse(this.title).name}` : "VLC Bridge Transcript";
    return this.title || "VLC Bridge Transcript";
  }

  async onOpen() {}
  createView() {
    if (!(this.length && this.mediaPath && this.subPath)) return;
    this.contentEl.empty();

    const container = this.contentEl.createDiv({ cls: "vlc-bridge-transcriptView" });
    this.optionsEl = container.createDiv({ cls: "vlc-bridge-transcript-options" });
    container.createEl("h2", { text: `${path.parse(this.title).name}` });
    this.transcriptEl = container.createDiv({ cls: "vlc-bridge-dialog-container" });
    this.setTranscriptEl();
    this.setOptionsEl();
  }

  setTranscriptEl() {
    const transcriptEl = this.transcriptEl;
    transcriptEl.empty();

    const subEntries = getSubEntries({
      length: { length: this.length },
      subPath: this.subPath,
      mediaPath: this.mediaPath,
      subDelay: this.subDelay,
      template: this.plugin.settings.transcriptTemplate,
    });
    if (!subEntries) return;
    const dialogsView = subEntries.map((entry, i, arr) => {
      const entryEl = transcriptEl.createDiv();
      const dialogEl = entryEl.createDiv({ cls: "vlc-bridge-ts-dialog" });
      const dialogOptEl = dialogEl.createDiv({ cls: "vlc-bridge-ts-dialog-options" });
      const dialogOptions = this.setDialogOptions(dialogOptEl, i);
      const dialogTextEl = dialogEl.createDiv({ cls: "vlc-bridge-ts-dialog-text" });
      entryEl.createEl("hr", { cls: "vlc-bridge-ts-separator" });

      const getDialogView = (reload: boolean, snapshotFiles?: TFile[] | undefined) => {
        const dialogEntry = this.dialogsView?.[i] || entry;
        if (reload) {
          dialogEntry.formattedStr = formatSubText(
            this.length * 1000,
            dialogEntry,
            i,
            { subPath: this.subPath, mediaPath: this.mediaPath, subDelay: this.subDelay },
            this.plugin.settings.transcriptTemplate
          );
        }
        if (dialogEntry.formattedStr.includes("{{snapshot}}")) {
          const timestampMs = this.plugin.settings.jumpMiddleOfDialog ? Math.round((dialogEntry.from + dialogEntry.to) / 2) : dialogEntry.from;
          const existingSnapshots = this.plugin.findExistingSnapshot(
            this.title
              .replaceAll("[", "［") // prevent wikilinks
              .replaceAll("]", "］"),
            timestampMs,
            dialogEntry.from,
            i + 1 < arr.length ? arr[i + 1].from : Infinity,
            this.plugin.settings.showAllSnapshotsInRange,
            snapshotFiles
          );
          if (existingSnapshots) {
            existingSnapshots.forEach((e, i, arr) => {
              dialogEntry.formattedStr = dialogEntry.formattedStr.replaceAll(/(.*({{snapshot}}).*$)/gm, (matched) => {
                return matched.replaceAll("{{snapshot}}", e.snapshotEmbed) + (i == arr.length - 1 ? "" : `\n${matched}`);
              });
            });
          }
        }
        const renderedDialog = createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            this.plugin.settings.useSimplierTranscriptFormat ? dialogEntry.simpleFormattedStr : dialogEntry.formattedStr.replaceAll("{{snapshot}}", ""),
            el.createDiv(),
            "",
            this
          );

          const snapshotEmbeds = el.querySelectorAll("img");
          snapshotEmbeds.forEach((embed) => {
            setTooltip(embed, embed.alt);
            const relativePath = decodeURIComponent(embed.src)
              .replace(Platform.resourcePathPrefix, "")
              .replace(normalizePath(this.plugin.app.vault.adapter.basePath) + "/", "");
            const embedFile = this.plugin.app.vault.getFileByPath(relativePath.substring(0, relativePath.lastIndexOf("?")));

            const snapshotName = path.parse(embed.src).name;
            const timestamp = this.plugin.snapshotPathToMs(snapshotName);
            if (timestamp) {
              embed.addClass("vlc-bridge-ts-ss-embed");
            }

            embed.onclick = async () => {
              if (!timestamp) return;
              const length = Math.round(this.length * 1000);
              const position = timestamp.milliseconds / length;
              this.plugin.openVideo({
                mediaPath: this.mediaPath,
                subPath: this.subPath,
                subDelay: this.subDelay?.toString(),
                timestamp: `${position * 100}%`,
                pause: true,
              });
            };
            embed.oncontextmenu = (event) => {
              if (!embedFile) {
                return;
              }
              const menu = new Menu();

              menu.addItem((item) =>
                item
                  .setTitle(t("Open in default app"))
                  .setIcon("image-play")
                  .onClick(() => {
                    this.plugin.app.openWithDefaultApp(embedFile.path);
                  })
              );

              menu.addItem((item) =>
                item
                  .setTitle(t("Reveal snapshot in navigation"))
                  .setIcon("folder-open")
                  .onClick(() => {
                    this.plugin.app.internalPlugins.getEnabledPluginById("file-explorer").revealInFolder(embedFile);
                  })
              );

              menu.addItem((item) =>
                item
                  .setTitle(t("Show snapshot in system explorer"))
                  .setIcon("square-arrow-out-up-right")
                  .onClick(() => {
                    this.plugin.app.showInFolder(embedFile.path);
                  })
              );

              menu.showAtMouseEvent(event);
            };
          });
        });
        dialogTextEl.replaceChildren(renderedDialog);
      };

      return {
        ...entry,
        checkbox: dialogOptions.checkbox,
        setRangeBtn: dialogOptions.setRangeBtn,
        // copyBtn: copyBtn,
        dialogEl: dialogEl,
        dialogTextEl: dialogTextEl,
        getDialogView,
        rangeMarker: i == 0 ? "start" : i == arr.length - 1 ? "end" : null,
      };
    });
    this.dialogsView = dialogsView;
    this.updateDialogs(false);
  }

  updateDialogs(reload: boolean) {
    let snapshotFiles: TFile[];
    if (this.plugin.settings.transcriptTemplate.includes("{{snapshot}}")) {
      const filename = this.title
        .replaceAll("[", "［") // prevent wikilinks
        .replaceAll("]", "］");
      snapshotFiles = this.app.vault.getFiles().filter((f) => f.path.startsWith(`${this.plugin.settings.snapshotFolder}/${filename}/`));
    }
    this.dialogsView?.forEach((entry, i) => {
      entry.getDialogView(reload, snapshotFiles);
    });
  }

  setDialogOptions(dialogOptEl: HTMLDivElement, i: number) {
    const checkbox: ToggleComponent = new ToggleComponent(dialogOptEl).setValue(false);
    checkbox.toggleEl.addClass("mod-small");

    new ExtraButtonComponent(dialogOptEl)
      .setIcon("lucide-copy")
      .setTooltip(t("Copy to clipboard"))
      .onClick(async () => {
        let formattedStr;
        if (this.dialogsView[i].formattedStr.includes("{{snapshot}}")) {
          formattedStr = await this.plugin.getSubWithSnapshots({
            parsedEntries: {
              entries: [this.dialogsView[i]],
              filename: this.title,
              length: this.length,
              mediaPath: this.mediaPath,
              subPath: this.subPath,
              subDelay: this.subDelay,
            },
          });
        } else {
          formattedStr = this.dialogsView[i].formattedStr;
        }
        if (formattedStr) {
          await navigator.clipboard.writeText(formattedStr);
          new Notice(t("Copied to clipboard"));
        }
      });

    const updateRange = () => {
      const startMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "start");
      const endMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "end");
      const start = Math.min(startMarker, endMarker);
      const end = Math.max(startMarker, endMarker);
      this.dialogsView.forEach((e, i) => {
        if (i < start || i > end) {
          e.setRangeBtn.extraSettingsEl.removeClass("mod-warning");
          e.setRangeBtn.setIcon("minus");
        } else {
          e.setRangeBtn.extraSettingsEl.addClass("mod-warning");
          e.setRangeBtn.setIcon("chevrons-left-right-ellipsis");
        }
      });
    };
    const setRangeBtn: ExtraButtonComponent = new ExtraButtonComponent(dialogOptEl).setIcon("chevrons-left-right-ellipsis").setTooltip(t("Adjust range"));
    setRangeBtn.extraSettingsEl.onclick = async (event) => {
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(t("Set as start of range"))
          .setIcon("list-start")
          .onClick(() => {
            if (this.dialogsView[i].rangeMarker !== null) {
              return;
            }
            const currentMarker = this.dialogsView.find((e) => e.rangeMarker == "start");
            if (currentMarker) {
              currentMarker.rangeMarker = null;
            }
            this.dialogsView[i].rangeMarker = "start";
            updateRange();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(t("Set as end of range"))
          .setIcon("list-end")
          .onClick(() => {
            if (this.dialogsView[i].rangeMarker !== null) {
              return;
            }
            const currentMarker = this.dialogsView.find((e) => e.rangeMarker == "end");
            if (currentMarker) {
              currentMarker.rangeMarker = null;
            }
            this.dialogsView[i].rangeMarker = "end";
            updateRange();
          })
      );

      menu.showAtMouseEvent(event);
    };
    setRangeBtn.extraSettingsEl.addClass("mod-warning");

    return { checkbox, setRangeBtn };
  }

  setOptionsEl() {
    const optionsEl = this.optionsEl;
    optionsEl.hide();
    const searchEl = optionsEl.createDiv({ cls: ["vlc-bridge-transcript-options", "searchEl"] });
    const searchInput = new SearchComponent(searchEl).onChange((value) => {
      this.searchRegex = new RegExp(`(${value.replaceAll(/([+*?.])/gi, "\\$1")})`, this.searchRegex?.flags || "gi");
    });
    searchInput.clearButtonEl.onclick = () => {
      this.searchAndMark(true);
    };

    this.registerDomEvent(searchInput.inputEl, "keydown", (ev) => {
      if (ev.key == "Enter") {
        if (this.searchMatches.matchedRegex == this.searchRegex) {
          if (this.searchMatches.spanArr.length) {
            this.focusMatch(this.searchMatches.spanArr.findIndex((e) => e.hasClass("current")) + 1, true);
          }
        } else {
          this.searchAndMark();
        }
      }
    });
    searchEl.createEl("span", { text: "", cls: "vlc-bridge-trabscript-search-count" });
    const caseSensitiveBtn = new ExtraButtonComponent(searchEl)
      .setIcon("case-sensitive")
      .setTooltip(t("Case-sensitive"))
      .onClick(() => {
        if (caseSensitiveBtn.extraSettingsEl.hasClass("mod-warning")) {
          caseSensitiveBtn.extraSettingsEl.removeClass("mod-warning");
          if (this.searchRegex) {
            this.searchRegex = new RegExp(`${this.searchRegex?.source || "()"}`, "ig");
            this.searchAndMark();
          }
        } else {
          caseSensitiveBtn.extraSettingsEl.addClass("mod-warning");
          if (this.searchRegex) {
            this.searchRegex = new RegExp(`${this.searchRegex?.source || "()"}`, "g");
            this.searchAndMark();
          }
        }
      });
    new ExtraButtonComponent(searchEl).setIcon("chevron-up").onClick(() => {
      const currentIndex = this.searchMatches.spanArr.findIndex((e) => e.hasClass("current"));
      if (currentIndex !== -1) {
        this.focusMatch(currentIndex - 1, true, currentIndex);
      }
    });
    new ExtraButtonComponent(searchEl).setIcon("chevron-down").onClick(() => {
      const currentIndex = this.searchMatches.spanArr.findIndex((e) => e.hasClass("current"));
      if (currentIndex !== -1) {
        this.focusMatch(currentIndex + 1, true, currentIndex);
      }
    });
  }
  setActions() {
    this.addCopyLinesAction();
    this.addSelectLinesAction();
    this.addViewCurrentLineAction();
    this.addFollowCurrentLineAction();
    this.addRefreshAction();
    this.addSearchAction();
  }
  addCopyLinesAction() {
    this.addAction("copy", t("Copy dialogs"), (event) => {
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(t("Copy selected dialogs"))
          .setIcon("list-todo")
          .onClick(async () => {
            const selectedDialogs = this.dialogsView.filter((e) => e.checkbox.getValue());
            let formattedStr;
            if (selectedDialogs) {
              if (selectedDialogs.some((e) => e.formattedStr.includes("{{snapshot}}"))) {
                formattedStr = await this.plugin.getSubWithSnapshots({
                  parsedEntries: {
                    entries: selectedDialogs,
                    filename: this.title,
                    length: this.length,
                    mediaPath: this.mediaPath,
                    subPath: this.subPath,
                    subDelay: this.subDelay,
                  },
                });
              } else {
                formattedStr = selectedDialogs.map((e) => e.formattedStr).join("\n");
              }
              if (formattedStr) {
                await navigator.clipboard.writeText(formattedStr);
                new Notice(t("Copied to clipboard"));
              }
            }
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("Copy dialogs in range"))
          .setIcon("logs")
          .onClick(async () => {
            const startMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "start");
            const endMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "end");
            const start = Math.min(startMarker, endMarker);
            const end = Math.max(startMarker, endMarker);

            const selectedDialogs = this.dialogsView.slice(start || 0, (end || this.dialogsView.length - 1) + 1);
            let formattedStr;
            if (selectedDialogs) {
              if (selectedDialogs.some((e) => e.formattedStr.includes("{{snapshot}}"))) {
                formattedStr = await this.plugin.getSubWithSnapshots({
                  parsedEntries: {
                    entries: selectedDialogs,
                    filename: this.title,
                    length: this.length,
                    mediaPath: this.mediaPath,
                    subPath: this.subPath,
                    subDelay: this.subDelay,
                  },
                });
              } else {
                formattedStr = selectedDialogs.map((e) => e.formattedStr).join("\n");
              }
              if (formattedStr) {
                await navigator.clipboard.writeText(formattedStr);
                new Notice(t("Copied to clipboard"));
              }
            }
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("Copy all"))
          .setIcon("list-plus")
          .onClick(async () => {
            let formattedStr;
            if (this.dialogsView.first()?.formattedStr.includes("{{snapshot}}")) {
              formattedStr = await this.plugin.getSubWithSnapshots({
                parsedEntries: {
                  entries: this.dialogsView,
                  filename: this.title,
                  length: this.length,
                  mediaPath: this.mediaPath,
                  subPath: this.subPath,
                  subDelay: this.subDelay,
                },
              });
            } else {
              formattedStr = this.dialogsView.map((e) => e.formattedStr).join("\n");
            }
            if (formattedStr) {
              await navigator.clipboard.writeText(formattedStr);
              new Notice(t("Copied to clipboard"));
            }
          })
      );

      menu.showAtMouseEvent(event);
    });
  }
  addSelectLinesAction() {
    this.addAction("square-check-big", t("Toggle dialogs in range"), (event) => {
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(t("Select in range"))
          .setIcon("list-checks")
          .onClick(() => {
            const startMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "start");
            const endMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "end");
            const start = Math.min(startMarker, endMarker);
            const end = Math.max(startMarker, endMarker);
            this.dialogsView.forEach((e, i) => {
              if (i >= start && i <= end) {
                e.checkbox.setValue(true);
              }
            });
          })
      );
      menu.addItem((item) =>
        item
          .setTitle(t("Deselect in range"))
          .setIcon("layout-list")
          .onClick(() => {
            const startMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "start");
            const endMarker = this.dialogsView.findIndex((e) => e.rangeMarker == "end");
            const start = Math.min(startMarker, endMarker);
            const end = Math.max(startMarker, endMarker);
            this.dialogsView.forEach((e, i) => {
              if (i >= start && i <= end) {
                e.checkbox.setValue(false);
              }
            });
          })
      );

      menu.showAtMouseEvent(event);
    });
  }
  async jumpCurrentLine(type: "jump" | "follow", actionBtn?: HTMLElement) {
    const status = (await this.plugin.sendVlcRequest(""))?.json;
    if (status?.position && (await this.plugin.getCurrentVideo())?.uri == this.mediaPath) {
      const currentPos = status?.position;
      const positionMs = Math.round(this.length * currentPos * 1000);

      const currentDialog = this.dialogsView.find((e, i, arr) => (e.from <= positionMs && i + 1 < arr.length ? positionMs < arr[i + 1]?.from : true));
      if (currentDialog) {
        if (type == "jump") {
          currentDialog.dialogEl.scrollIntoView({ behavior: "smooth", block: "center" });
          currentDialog.dialogEl.addClass("vlc-bridge-ts-dialog-focus");
          setTimeout(() => {
            currentDialog?.dialogEl.removeClass("vlc-bridge-ts-dialog-focus");
          }, 1000);
        } else {
          if (!currentDialog.dialogEl.hasClass("vlc-bridge-ts-dialog-focus")) {
            this.dialogsView.forEach((e) => {
              if (e !== currentDialog) {
                e.dialogEl.removeClass("vlc-bridge-ts-dialog-focus");
              }
            });
            currentDialog.dialogEl.addClass("vlc-bridge-ts-dialog-focus");
            if (this.followAndScroll) {
              currentDialog.dialogEl.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
        }
      } else {
        if (type == "jump") {
          new Notice(t("Current dialog could not be detected"));
          return;
        }
      }
    } else {
      if (actionBtn) {
        actionBtn.removeClass("mod-cta");
      }
      if (this.followingInterval) {
        clearInterval(this.followingInterval);
        this.dialogsView.forEach((e) => {
          e.dialogEl.removeClass("vlc-bridge-ts-dialog-focus");
        });
      }
      new Notice(t("Current dialog could not be detected"));
      return;
    }
  }
  addViewCurrentLineAction() {
    this.addAction("scan", t("Show current dialog"), async (event) => {
      this.jumpCurrentLine("jump");
    });
  }
  addFollowCurrentLineAction() {
    const actionBtn = this.addAction("scan-eye", t("Follow current dialog"), async (event) => {
      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle(t("Highlight and scroll"))
          .setIcon("focus")
          .onClick(() => {
            actionBtn.addClass("mod-cta");
            this.followAndScroll = true;
            if (!this.followingInterval) {
              this.followingInterval = window.setInterval(async () => {
                await this.jumpCurrentLine("follow", actionBtn);
              }, 500);

              this.plugin.registerInterval(this.followingInterval);
            }
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(t("Only highlight"))
          .setIcon("highlighter")
          .onClick(() => {
            actionBtn.addClass("mod-cta");
            this.followAndScroll = false;
            if (!this.followingInterval) {
              this.followingInterval = window.setInterval(async () => {
                await this.jumpCurrentLine("follow", actionBtn);
              }, 500);

              this.plugin.registerInterval(this.followingInterval);
            }
          })
      );

      menu.addItem((item) =>
        item
          .setTitle(t("Stop"))
          .setIcon("octagon-x")
          .onClick(() => {
            actionBtn.removeClass("mod-cta");
            if (this.followingInterval) {
              clearInterval(this.followingInterval);
              this.followingInterval = null;
            }

            this.dialogsView.forEach((e) => {
              e.dialogEl.removeClass("vlc-bridge-ts-dialog-focus");
            });
          })
      );

      menu.showAtMouseEvent(event);
    });
  }

  addRefreshAction() {
    this.addAction("rotate-ccw", t("Reload"), () => {
      this.updateDialogs(true);
    });
  }
  addSearchAction() {
    const actionBtn = this.addAction("search", t("Search in transcript"), () => {
      if (actionBtn.hasClass("mod-cta")) {
        actionBtn.removeClass("mod-cta");
        this.optionsEl.hide();
        this.searchMatches.spanArr.forEach((el) => {
          el.toggleClass("vlc-bridge-ts-dialog-search", false);
        });

        if (this.searchRegex?.source?.length == 2) {
          this.searchAndMark();
        }
      } else {
        actionBtn.addClass("mod-cta");
        this.optionsEl.show();
        this.searchMatches.spanArr.forEach((el) => {
          el.toggleClass("vlc-bridge-ts-dialog-search", true);
        });
      }
    });
  }
  searchAndMark(clear?: boolean) {
    // Source: https://stackoverflow.com/a/7557433
    const isElementInViewport = (el: HTMLSpanElement) => {
      const rect = el.getBoundingClientRect();
      const dialogContainer = this.transcriptEl; //?.querySelector(".vlc-bridge-dialog-container") as HTMLDivElement;
      const parentRect = dialogContainer.getBoundingClientRect();
      return (
        rect.top - parentRect.top >= 0 && rect.bottom <= (parentRect.height || document.documentElement.clientHeight) /* or $(window).height() */ //&&
      );
    };

    const markClass = "vlc-bridge-ts-dialog-search";
    const searchMatches: HTMLSpanElement[] = [];
    const regex = this.searchRegex;
    this.dialogsView.forEach((dialog) => {
      const viewedStr = this.plugin.settings.useSimplierTranscriptFormat ? dialog.simpleFormattedStr : dialog.formattedStr.replaceAll("{{snapshot}}", "");
      if (!clear && regex.source.length > 2 && viewedStr.match(regex)) {
        let highlightedText = viewedStr.toString();
        if (this.plugin.settings.onlySearchWithinTextInTranscriptView) {
          dialog.text.split("\n").forEach((text) => {
            highlightedText = highlightedText.replaceAll(text, (matched) => {
              return matched.replaceAll(regex, `<span class="${markClass}">$1</span>`);
            });
          });
        } else {
          highlightedText = highlightedText.replaceAll(regex, `<span class="${markClass}">$1</span>`);
        }

        const highlightedEl = createFragment((el) => {
          MarkdownRenderer.render(this.app, highlightedText, el.createDiv(), "", this);
        });
        (dialog.dialogTextEl.firstChild as HTMLDivElement).replaceWith(highlightedEl);
        dialog.dialogTextEl.querySelectorAll(`span.${markClass}`).forEach((el: HTMLSpanElement, key: number) => {
          searchMatches.push(el);
        });
      } else {
        if (dialog.dialogTextEl.querySelectorAll(`span.${markClass}`).length > 0) {
          dialog.getDialogView(false);
        }
      }
    });
    this.searchMatches.spanArr = searchMatches;
    this.searchMatches.matchedRegex = regex;
    if (this.searchMatches.spanArr.length) {
      const indexOfSpanAtView = this.searchMatches.spanArr.findIndex((e) => isElementInViewport(e));

      this.focusMatch(indexOfSpanAtView == -1 ? 0 : indexOfSpanAtView, indexOfSpanAtView == -1 ? true : false);
    } else {
      this.optionsEl.querySelector(".vlc-bridge-trabscript-search-count")?.setText("0/0");
    }
  }
  focusMatch(index: number, scroll: boolean, curentIndex_?: number) {
    const currentIndex = curentIndex_ || this.searchMatches.spanArr.findIndex((e) => e.hasClass("current"));
    if (currentIndex !== -1) {
      this.searchMatches.spanArr[currentIndex].removeClass("current");
    }
    if (index < 0) {
      index = this.searchMatches.spanArr.length - 1;
    } else if (index > this.searchMatches.spanArr.length - 1) {
      index = 0;
    }
    this.optionsEl.querySelector(".vlc-bridge-trabscript-search-count")?.setText(`${index + 1}/${this.searchMatches.spanArr.length}`);
    this.searchMatches.spanArr[index].addClass("current");
    if (scroll) {
      this.searchMatches.spanArr[index].scrollIntoView({ behavior: "smooth", inline: "center", block: "center" });
    }
  }

  async onClose() {}
}
