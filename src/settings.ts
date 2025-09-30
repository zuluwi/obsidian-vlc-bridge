import { App, Notice, PluginSettingTab, Setting, MarkdownRenderer, SliderComponent, TextComponent, ButtonComponent, ToggleComponent, Platform, TFile } from "obsidian";
import VLCBridgePlugin from "./main";
import { t } from "./language/helpers";
import { currentConfig } from "./vlcHelper";
import isPortReachable from "is-port-reachable";
import * as childProcess from "child_process";
import * as path from "path";
import { formatSubText, subtitlePlaceholder } from "./subtitleParser";
import { VIEW_TYPE_VB } from "./transcriptView";

declare global {
  interface Window {
    electron: any;
  }
}
export interface VBPluginSettings {
  port: number;
  password: string;
  snapshotPrefix: string;
  snapshotFolder: string;
  snapshotExt: "png" | "jpg" | "tiff";
  currentFile: string | null;
  vlcPath: string;
  syncplayPath: string;
  lang: string;
  normalSeek: number;
  largeSeek: number;
  alwaysOnTop: boolean;
  pauseOnPasteLink: boolean;
  pauseOnPasteSnapshot: boolean;
  timestampOffset: number;
  usePercentagePosition: boolean;
  timestampLinktext: string;
  timestampLinkTemplate: string;
  snapshotLinktext: string;
  snapshotLinkTemplate: string;
  commandPath: "cli" | "vlcPath";
  spCommandPath: "cli" | "spPath";
  keepTranscriptViews: boolean;
  useSimplierTranscriptFormat: boolean;
  onlySearchWithinTextInTranscriptView: boolean;
  jumpMiddleOfDialog: boolean;
  showAllSnapshotsInRange: boolean;
  transcriptTemplate: string;
}

export const DEFAULT_SETTINGS: VBPluginSettings = {
  port: 1234,
  password: "vlcpassword",
  snapshotPrefix: "image",
  snapshotFolder: "vlcSnapshots",
  snapshotExt: "png",
  currentFile: null,
  vlcPath: "",
  syncplayPath: "",
  lang: "en",
  normalSeek: 5,
  largeSeek: 60,
  alwaysOnTop: true,
  pauseOnPasteLink: false,
  pauseOnPasteSnapshot: false,
  timestampOffset: 0,
  usePercentagePosition: false,
  timestampLinktext: "{{timestamp}}",
  timestampLinkTemplate: "{{timestamplink}} ",
  snapshotLinktext: "{{filename}} {{timestamp}}",
  snapshotLinkTemplate: "{{timestamplink}} \n{{snapshot}} \n",
  commandPath: "cli",
  spCommandPath: "cli",
  keepTranscriptViews: false,
  useSimplierTranscriptFormat: false,
  onlySearchWithinTextInTranscriptView: true,
  jumpMiddleOfDialog: true,
  showAllSnapshotsInRange: false,
  transcriptTemplate: "{{index}}. {{from}} >> {{to}}\n{{text}}",
};

const snapshotExts = {
  png: "png",
  jpg: "jpg",
  tiff: "tiff",
};

export class VBPluginSettingsTab extends PluginSettingTab {
  plugin: VLCBridgePlugin;
  lastSnapshotPath: string;
  lasttranscriptTemplate: string;
  constructor(app: App, plugin: VLCBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const isPortAvailable = (port: number) => {
      return new Promise<boolean>(async (resolve) => {
        const isPortInUse = await isPortReachable(port, { host: "localhost" });
        if (isPortInUse) {
          if ((port == this.plugin.settings.port || port == currentConfig.port) && (await this.plugin.checkPort())) {
            resolve(true);
          } else {
            resolve(false);
          }
        } else {
          resolve(true);
        }
      });
    };

    let copyUrlEl: Setting;
    let copyCommandEl: Setting;
    let syncplayArgEl: Setting;

    const setSettingDesc = () => {
      syncplayArgEl.setDesc(this.plugin.vlcExecOptions("syncplay").join(" "));
      copyUrlEl.setDesc(`http://:${this.plugin.settings.password}@localhost:${this.plugin.settings.port}/`);
      copyCommandEl.setDesc(this.plugin.vlcExecOptions("vlc").join(" "));

      tsLinkTextSetting.setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `## \\[ **${this.plugin.settings.timestampLinktext}** ]( {{vlcBridge URI}} ) \n#### ${t("Placeholders")} \n- \`{{filename}}\` \n- \`{{timestamp}}\` \n\n`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      );
      ssLinkTextSetting.setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `## \\!\\[[ {{${t("Snapshot path")}}} | **${this.plugin.settings.snapshotLinktext}** ]] \n#### ${t("Placeholders")} \n- \`{{filename}}\` \n- \`{{timestamp}}\` \n`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      );
      transcriptTemplateSetting.setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `#### ${t("Placeholders")} \n- \`{{index}}\` \n- \`{{from}}\` \n- \`{{to}}\` \n- \`{{text}}\`\n- \`{{snapshot}}\`\n${
              this.plugin.settings.transcriptTemplate.includes("{{snapshot}}")
                ? `\n>[!info]\n>${t("For the {{1}} values in your template, snapshot will be captured and inserted when you copy the dialogs.", ["`{{snapshot}}`"])}\n`
                : ""
            }`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      );
    };

    const snapshots = this.app.vault.getFiles().filter((f) => f.path.startsWith(this.plugin.settings.snapshotFolder) && Object.values(snapshotExts).includes(f.extension));
    let placeholderSnapshot: TFile | undefined;
    let placeholderFilename: string | undefined;
    let placeholderTimestamp: string | undefined;

    if (snapshots.length > 0) {
      placeholderSnapshot = snapshots[Math.floor(Math.random() * snapshots.length)];
      placeholderFilename = this.plugin.snapshotPathToMs(placeholderSnapshot.path)?.filename;
      placeholderTimestamp = this.plugin.snapshotPathToMs(placeholderSnapshot.path)?.timestamp;
    }
    const blankSnapshot =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAHgCAYAAAA10dzkAAAYoElEQVR4Xu3WQREAIAwDQRCPAqQiAGawcVsH2fSRefa6wxEgQIAAAQIECGQEpgGY6VpQAgQIECBAgMAXMAA9AgECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECBiAfoAAAQIECBAgEBMwAGOFi0uAAAECBAgQMAD9AAECBAgQIEAgJmAAxgoXlwABAgQIECBgAPoBAgQIECBAgEBMwACMFS4uAQIECBAgQMAA9AMECBAgQIAAgZiAARgrXFwCBAgQIECAgAHoBwgQIECAAAECMQEDMFa4uAQIECBAgAABA9APECBAgAABAgRiAgZgrHBxCRAgQIAAAQIGoB8gQIAAAQIECMQEDMBY4eISIECAAAECBAxAP0CAAAECBAgQiAkYgLHCxSVAgAABAgQIGIB+gAABAgQIECAQEzAAY4WLS4AAAQIECBAwAP0AAQIECBAgQCAmYADGCheXAAECBAgQIGAA+gECBAgQIECAQEzAAIwVLi4BAgQIECBAwAD0AwQIECBAgACBmIABGCtcXAIECBAgQICAAegHCBAgQIAAAQIxAQMwVri4BAgQIECAAAED0A8QIECAAAECBGICBmCscHEJECBAgAABAgagHyBAgAABAgQIxAQMwFjh4hIgQIAAAQIEDEA/QIAAAQIECBCICRiAscLFJUCAAAECBAgYgH6AAAECBAgQIBATMABjhYtLgAABAgQIEDAA/QABAgQIECBAICZgAMYKF5cAAQIECBAgYAD6AQIECBAgQIBATMAAjBUuLgECBAgQIEDAAPQDBAgQIECAAIGYgAEYK1xcAgQIECBAgIAB6AcIECBAgAABAjEBAzBWuLgECBAgQIAAAQPQDxAgQIAAAQIEYgIGYKxwcQkQIECAAAECBqAfIECAAAECBAjEBAzAWOHiEiBAgAABAgQMQD9AgAABAgQIEIgJGICxwsUlQIAAAQIECDxCyLTs0ABWzAAAAABJRU5ErkJggg==";

    const filename = placeholderFilename || "The.Shawshank.Redemption.1994";
    const timestamp = placeholderTimestamp || "02:22:32";
    const placeholderImgUrl = placeholderSnapshot ? this.app.vault.adapter.getFilePath(placeholderSnapshot.path) : blankSnapshot;
    let tsLinkStr: string;
    let tsLinkTemplateStr: string;
    let ssLinkStr: string;
    let ssLinkTemplateStr: string;
    const updateTemplatePreviews = () => {
      tsLinkStr = `[${this.plugin.settings.timestampLinktext.replaceAll("{{filename}}", filename).replaceAll("{{timestamp}}", timestamp)}](vlcBridgeUri)`;
      tsLinkTemplateStr = this.plugin.settings.timestampLinkTemplate
        .replaceAll("{{timestamplink}}", tsLinkStr)
        .replaceAll("{{filename}}", filename)
        .replaceAll("{{timestamp}}", timestamp);
      ssLinkStr = `![${this.plugin.settings.snapshotLinktext.replaceAll("{{filename}}", filename).replaceAll("{{timestamp}}", timestamp)}](${placeholderImgUrl})`;
      ssLinkTemplateStr = this.plugin.settings.snapshotLinkTemplate
        .replaceAll("{{timestamplink}}", tsLinkStr)
        .replaceAll("{{filename}}", filename)
        .replaceAll("{{timestamp}}", timestamp)
        .replaceAll("{{snapshot}}", ssLinkStr);

      tsTemplatePreview.setName(
        createFragment((el) => {
          MarkdownRenderer.render(this.app, `## ${t("Timestamp preview")}\n${tsLinkTemplateStr}\n`, el.createDiv(), "", this.plugin);
        })
      );
      ssTemplatePreview.setName(
        createFragment((el) => {
          MarkdownRenderer.render(this.app, `## ${t("Snapshot preview")}\n${ssLinkTemplateStr}\n`, el.createDiv(), "", this.plugin);
        })
      );
    };
    const updateTranscriptTemplatePreview = () => {
      const transcriptTemplateStr = subtitlePlaceholder
        .map((entry, i) => {
          return formatSubText(8552 * 1000, entry, i, { mediaPath: "", subPath: "", subDelay: null }, this.plugin.settings.transcriptTemplate).replaceAll(
            "{{snapshot}}",
            ssLinkStr
          );
        })
        .join("\n");

      transcriptTemplatePreview.setName(
        createFragment((el) => {
          MarkdownRenderer.render(this.app, `## ${t("Transcript preview")}\n${transcriptTemplateStr}\n`, el.createDiv(), "", this.plugin);
        })
      );
    };

    const vlcPathToggleArr: ToggleComponent[] = [];

    const vlcCliCheck = new Setting(containerEl);
    if (this.plugin.cliExist) {
      vlcCliCheck
        .setDesc(
          createFragment((el) => {
            MarkdownRenderer.render(this.app, `## ${t("{{1}} CLI command is available.", ["**`vlc`**"])}\n`, el.createDiv(), "", this.plugin);
          })
        )
        .addButton((btn) => {
          btn.setWarning().setIcon("lucide-check-check").setDisabled(true);
        });
      if (Platform.isWin) {
        vlcCliCheck.addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.commandPath == "cli" || !this.plugin.settings.vlcPath?.length)
            .setDisabled(this.plugin.settings.commandPath == "cli" || !this.plugin.settings.vlcPath?.length)
            .onChange(async (value) => {
              toggle.setDisabled(value);
              if (value == true) {
                this.plugin.settings.commandPath = "cli";
                await this.plugin.saveSettings();
                vlcPathToggleArr.map((t) => {
                  if (t !== toggle) {
                    t.setValue(false);
                  }
                });
              } else {
                await this.plugin.saveSettings();
              }
              setSettingDesc();
            });
          vlcPathToggleArr.push(toggle);
        });
      }
    } else {
      vlcCliCheck
        .setDesc(
          createFragment((el) => {
            MarkdownRenderer.render(this.app, `## ${t("{{1}} CLI command is not installed on your system.", ["**`vlc`**"])}\n`, el.createDiv(), "", this.plugin);
          })
        )
        .addButton((btn) => {
          btn
            .setIcon("lucide-unlink")
            .setDisabled(true)
            .setTooltip(t("{{1}} CLI command is not installed on your system.", [`'vlc'`]));
        });
      if (Platform.isWin) {
        vlcCliCheck.addToggle((toggle) => {
          toggle.setDisabled(true).setValue(false);
        });
      }
    }

    if (Platform.isWin) {
      let selectVLCDescEl: HTMLElement;
      let selectVLCBtnEl: ButtonComponent;
      let vlcPathToggle: ToggleComponent;
      const selectVLC = new Setting(containerEl)
        .setName(t("VLC path"))
        .setDesc(t("Select 'vlc.exe' from the folder where VLC Player is installed"))
        // auto-detect path
        .addButton((btn) => {
          btn.setButtonText(t("Try auto-detect")).onClick(async () => {
            // Source:
            // https://forums.powershell.org/t/getting-the-path-of-a-program/21447/11
            const findInstalledLocationCommand = `powershell.exe "Get-ItemProperty -Path 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object {$_.DisplayName -match 'VLC media player'} | Select InstallLocation"`;
            try {
              const output = childProcess.execSync(findInstalledLocationCommand).toString();
              console.log("Detected Location:" + output);

              if (output && output.toLowerCase().contains("vlc")) {
                const lastLine = output.trim().split("\n")?.pop()?.trim() as string;
                const installedPath = path.join(lastLine, "vlc.exe");
                this.plugin.settings.vlcPath = installedPath;
                selectVLCDescEl.innerText = installedPath;
                await this.plugin.saveSettings();
                vlcPathToggle.setValue(this.plugin.settings.commandPath == "vlcPath" && this.plugin.settings.vlcPath?.length > 0);
                vlcPathToggle.setDisabled(this.plugin.settings.commandPath == "vlcPath" && this.plugin.settings.vlcPath?.length > 0);
                if (this.plugin.settings.commandPath == "vlcPath") {
                  setSettingDesc();
                }
              } else {
                selectVLCBtnEl.setWarning();
                new Notice(t("Failed to detect the installation location of {{1}}. Please try selecting it manually.", ["VLC Media Player"]));
              }
            } catch (err) {
              selectVLCBtnEl.setWarning();

              console.error(`Error: ${err.message}`);
              new Notice(t("Failed to detect the installation location of {{1}}. Please try selecting it manually.", ["VLC Media Player"]));
            }
          });
        })
        // manually select
        .addButton((btn) => {
          selectVLCBtnEl = btn;
          btn
            .setDisabled(this.plugin.settings.commandPath !== "vlcPath")
            .setButtonText(t("Select vlc.exe"))
            .onClick(() => {
              window.electron.remote.dialog
                .showOpenDialog({
                  title: t("Select vlc.exe"),
                  properties: ["openFile"],
                  filters: [
                    {
                      name: "vlc",
                      extensions: ["exe"],
                    },
                  ],
                })
                .then(async (result: { canceled: boolean; filePaths: string[] }) => {
                  console.log("Selected file:", result);
                  if (!result.canceled && result.filePaths.length) {
                    const file = result.filePaths[0];
                    this.plugin.settings.vlcPath = file;
                    selectVLCDescEl.innerText = file;
                    await this.plugin.saveSettings();
                    vlcPathToggle.setDisabled(this.plugin.settings.commandPath == "vlcPath" && this.plugin.settings.vlcPath?.length > 0);
                    setSettingDesc();
                  }
                })
                .catch((err: Error) => {
                  console.log(err);
                });
            });
        })
        // toggle
        .addToggle((toggle) => {
          vlcPathToggle = toggle;
          toggle
            .setValue(this.plugin.settings.commandPath == "vlcPath" && this.plugin.settings.vlcPath?.length > 0)
            .setDisabled(this.plugin.settings.commandPath == "vlcPath" || !this.plugin.settings.vlcPath?.length)
            .onChange(async (value) => {
              toggle.setDisabled(value);
              if (value == true) {
                this.plugin.settings.commandPath = "vlcPath";
                await this.plugin.saveSettings();
                vlcPathToggleArr.map((t) => {
                  if (t !== toggle) {
                    t.setValue(false);
                  }
                });
              } else {
                await this.plugin.saveSettings();
              }
              selectVLCBtnEl.setDisabled(this.plugin.settings.commandPath !== "vlcPath");
            });
          vlcPathToggleArr.push(toggle);
        });
      selectVLCDescEl = selectVLC.descEl.createEl("div").createEl("b", { text: this.plugin.settings.vlcPath || "" });
    }
    new Setting(containerEl)
      .setName(t("Port"))
      .setDesc(t("Enter a port number between 1 and 65535 for the server that will be opened to control VLC Player"))
      .addText(async (text) => {
        text
          .setPlaceholder(this.plugin.settings.port.toString())
          .setValue(this.plugin.settings.port.toString())
          .onChange(async (value) => {
            if (isNaN(Number(value)) || 65535 < Number(value) || 1 > Number(value)) {
              text.inputEl.addClass("warning");
            } else if (!(await isPortAvailable(Number(value)))) {
              text.inputEl.addClass("warning");
              new Notice(t("The port you selected is not usable, please enter another port value"));
            } else {
              text.inputEl.removeClass("warning");
              this.plugin.settings.port = Number(value);
              await this.plugin.saveSettings();
              setSettingDesc();
            }
          });
        text.inputEl.addClass("vlc-bridge-text-input");

        if (!(await isPortAvailable(this.plugin.settings.port))) {
          text.inputEl.addClass("warning");
          new Notice(t("The port you selected is not usable, please enter another port value"));
        }
      });

    new Setting(containerEl).setName(t("Always show VLC Player on top")).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.alwaysOnTop).onChange(async (value) => {
        this.plugin.settings.alwaysOnTop = value;
        await this.plugin.saveSettings();
        setSettingDesc();
      });
    });
    new Setting(containerEl).setName(t("Pause video while pasting timestamp")).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.pauseOnPasteLink).onChange((value) => {
        this.plugin.settings.pauseOnPasteLink = value;
        this.plugin.saveSettings();
      });
    });
    new Setting(containerEl).setName(t("Pause video while pasting snapshot")).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.pauseOnPasteSnapshot).onChange((value) => {
        this.plugin.settings.pauseOnPasteSnapshot = value;
        this.plugin.saveSettings();
      });
    });
    new Setting(containerEl)
      .setName(t("Use percentile position instead of seconds as timestamp value in the link"))
      .setDesc(
        t("Allows you to open more precise (sub-second) time values. It is recommended to enable this option if you want to open exactly the same frame as when you get the link.")
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.usePercentagePosition).onChange(async (value) => {
          this.plugin.settings.usePercentagePosition = value;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (!this.plugin.settings.usePercentagePosition) {
      let tsOffsetSlider: SliderComponent;
      let tsOffsetText: TextComponent;
      new Setting(containerEl)
        .setName(t("Timestamp offset (in seconds)"))
        .addSlider((slider) => {
          tsOffsetSlider = slider;
          slider
            .setLimits(-60, 60, 1)
            .setDynamicTooltip()
            .setValue(this.plugin.settings.timestampOffset)
            .onChange(async (value) => {
              this.plugin.settings.timestampOffset = value;
              await this.plugin.saveSettings();
              tsOffsetText.setValue(this.plugin.settings.timestampOffset.toString());
            });
          return slider;
        })
        .addText((text) => {
          tsOffsetText = text;
          text.setValue(this.plugin.settings.timestampOffset.toString()).onChange(async (value) => {
            this.plugin.settings.timestampOffset = Number(value);
            await this.plugin.saveSettings();
            tsOffsetSlider.setValue(this.plugin.settings.timestampOffset);
          });
          text.inputEl.type = "number";
          text.inputEl.addClasses(["vlc-bridge-text-input", "number"]);
        });
    }

    new Setting(containerEl).setName(t("Link templates")).setHeading();

    new Setting(containerEl).setName(t("Timestamp link")).setHeading();

    const tsLinkTextSetting = new Setting(containerEl)
      .setName(t("Timestamp linktext"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.settings.timestampLinktext)
          .setValue(this.plugin.settings.timestampLinktext)
          .onChange(async (value) => {
            this.plugin.settings.timestampLinktext = value;
            await this.plugin.saveSettings();
            setSettingDesc();
            updateTemplatePreviews();
          });
        text.inputEl.addClasses(["vlc-bridge-text-input", "linktext"]);
        return text;
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.timestampLinktext = DEFAULT_SETTINGS.timestampLinktext;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(t("Timestamp template"))
      .setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(this.app, `#### ${t("Placeholders")} \n- \`{{timestamplink}}\` \n- \`{{filename}}\` \n- \`{{timestamp}}\`\n`, el.createDiv(), "", this.plugin);
        })
      )
      .addTextArea((text) => {
        text
          .setPlaceholder(this.plugin.settings.timestampLinkTemplate)
          .setValue(this.plugin.settings.timestampLinkTemplate)
          .onChange(async (value) => {
            this.plugin.settings.timestampLinkTemplate = value;
            await this.plugin.saveSettings();
            // setSettingDesc();
            updateTemplatePreviews();
          });

        text.inputEl.cols = 50;
        text.inputEl.rows = 5;

        return text;
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.timestampLinkTemplate = DEFAULT_SETTINGS.timestampLinkTemplate;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    new Setting(containerEl).setName(t("Show timestamp preview")).addToggle((toggle) => {
      toggle.onChange((value) => {
        if (value) {
          tsTemplatePreview.settingEl.show();
        } else {
          tsTemplatePreview.settingEl.hide();
        }
      });
    });
    const tsTemplatePreview = new Setting(containerEl);
    tsTemplatePreview.settingEl.hide();

    containerEl.createEl("h2", { text: t("Snapshot embed") });

    const ssLinkTextSetting = new Setting(containerEl)
      .setName(t("Snapshot linktext"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.settings.snapshotLinktext)
          .setValue(this.plugin.settings.snapshotLinktext)
          .onChange(async (value) => {
            this.plugin.settings.snapshotLinktext = value;
            await this.plugin.saveSettings();
            setSettingDesc();
            updateTemplatePreviews();
            if (this.plugin.settings.transcriptTemplate.includes("{{snapshot}}")) {
              updateTranscriptTemplatePreview();
            }
          });
        text.inputEl.addClasses(["vlc-bridge-text-input", "linktext"]);
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.snapshotLinktext = DEFAULT_SETTINGS.snapshotLinktext;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName(t("Snapshot template"))
      .setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `#### ${t("Placeholders")} \n- \`{{snapshot}}\` \n- \`{{timestamplink}}\` \n- \`{{filename}}\` \n- \`{{timestamp}}\`\n`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      )
      .addTextArea((text) => {
        text
          .setPlaceholder(this.plugin.settings.snapshotLinkTemplate)
          .setValue(this.plugin.settings.snapshotLinkTemplate)
          .onChange(async (value) => {
            this.plugin.settings.snapshotLinkTemplate = value;
            await this.plugin.saveSettings();
            // setSettingDesc();
            updateTemplatePreviews();
          });

        text.inputEl.cols = 50;
        text.inputEl.rows = 5;

        return text;
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.snapshotLinkTemplate = DEFAULT_SETTINGS.snapshotLinkTemplate;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl).setName(t("Show snapshot preview")).addToggle((toggle) => {
      toggle.onChange((value) => {
        if (value) {
          ssTemplatePreview.settingEl.show();
        } else {
          ssTemplatePreview.settingEl.hide();
        }
      });
    });
    const ssTemplatePreview = new Setting(containerEl);
    ssTemplatePreview.settingEl.hide();

    containerEl.createEl("h2", { text: t("Transcript view") });

    const transcriptTemplateSetting = new Setting(containerEl);
    transcriptTemplateSetting
      .setName(t("Transcript template"))

      .addTextArea((text) => {
        text
          .setPlaceholder(this.plugin.settings.transcriptTemplate)
          .setValue(this.plugin.settings.transcriptTemplate)
          .onChange(async (value) => {
            this.plugin.settings.transcriptTemplate = value;
            await this.plugin.saveSettings();
            setSettingDesc();
            updateTranscriptTemplatePreview();
          });

        text.inputEl.cols = 50;
        text.inputEl.rows = 5;

        return text;
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.transcriptTemplate = DEFAULT_SETTINGS.transcriptTemplate;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl).setName(t("Show transcript preview")).addToggle((toggle) => {
      toggle.onChange((value) => {
        if (value) {
          transcriptTemplatePreview.settingEl.show();
        } else {
          transcriptTemplatePreview.settingEl.hide();
        }
      });
    });
    const transcriptTemplatePreview = new Setting(containerEl);
    transcriptTemplatePreview.settingEl.hide();

    new Setting(containerEl)
      .setName(t("Keep transcript view when app closed"))
      .setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `>[!warning] \n>${t(
              `“Transcript View” tabs that you opened will be saved and then will re-open them the next time you launch Obsidian. If it takes a long time to load or may crash Obsidian, it is not recommended to use this feature.`
            )}`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.keepTranscriptViews).onChange((value) => {
          this.plugin.settings.keepTranscriptViews = value;
          this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("Use simplier format in transcript view"))
      .setDesc(t("If loading tab with your template takes a while, it is recommended to use this option. Original template will be used again when you copy the dialog."))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.useSimplierTranscriptFormat).onChange((value) => {
          this.plugin.settings.useSimplierTranscriptFormat = value;
          this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("Search only in dialog texts"))
      .setDesc(t("If you do not want to include all content when using the search feature, use this option."))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.onlySearchWithinTextInTranscriptView).onChange((value) => {
          this.plugin.settings.onlySearchWithinTextInTranscriptView = value;
          this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("Take snapshot in the middle of the dialog"))
      .setDesc(t("If your transcript template contains {{snapshot}}, jump to the middle of the dialog instead of the beginning to capture this snapshot."))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.jumpMiddleOfDialog).onChange((value) => {
          this.plugin.settings.jumpMiddleOfDialog = value;
          this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName(t("List all snapshots from the start of dialog to the start of the next dialog for the {{snapshot}} value in the transcript template"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showAllSnapshotsInRange).onChange((value) => {
          this.plugin.settings.showAllSnapshotsInRange = value;
          this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(t("Seeking amounts")).setHeading();

    let seekOffsetSlider: SliderComponent;
    let seekOffsetText: TextComponent;
    new Setting(containerEl)
      .setName(t("Normal seek amount (in seconds)"))
      .setDesc(t("Set the seek amount for 'Seek forward/backward' commands"))
      .addSlider((slider) => {
        seekOffsetSlider = slider;
        slider
          .setLimits(1, 60, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.normalSeek)
          .onChange(async (value) => {
            this.plugin.settings.normalSeek = value;
            await this.plugin.saveSettings();
            seekOffsetText.setValue(this.plugin.settings.normalSeek.toString());
          });
      })
      .addText((text) => {
        seekOffsetText = text;
        text.setValue(this.plugin.settings.normalSeek.toString()).onChange(async (value) => {
          this.plugin.settings.normalSeek = Number(value);
          await this.plugin.saveSettings();
          seekOffsetSlider.setValue(this.plugin.settings.normalSeek);
        });
        text.inputEl.type = "number";
        text.inputEl.addClasses(["vlc-bridge-text-input", "number"]);
      });

    let longSeekOffsetSlider: SliderComponent;
    let longSeekOffsetText: TextComponent;
    new Setting(containerEl)
      .setName(t("Long seek amount (in seconds)"))
      .setDesc(t("Set the seek amount for 'Long seek forward/backward' commands"))
      .addSlider((slider) => {
        longSeekOffsetSlider = slider;
        slider
          .setLimits(0, 10 * 60, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.largeSeek)
          .onChange(async (value) => {
            this.plugin.settings.largeSeek = value;
            await this.plugin.saveSettings();
            longSeekOffsetText.setValue(this.plugin.settings.largeSeek.toString());
          });
      })
      .addText((text) => {
        longSeekOffsetText = text;
        text.setValue(this.plugin.settings.largeSeek.toString()).onChange(async (value) => {
          this.plugin.settings.largeSeek = Number(value);
          await this.plugin.saveSettings();
          longSeekOffsetSlider.setValue(this.plugin.settings.largeSeek);
        });
        text.inputEl.type = "number";
        text.inputEl.step = "5";
        text.inputEl.addClasses(["vlc-bridge-text-input", "number"]);
      });

    new Setting(containerEl).setName(t("Snapshot")).setHeading();

    const folderNamePattern = /^[A-Za-z0-9][^\\\<\>\"\*\:\|\?]*$/gi;
    this.lastSnapshotPath = this.plugin.settings.snapshotFolder.toString();
    this.lasttranscriptTemplate = this.plugin.settings.transcriptTemplate.toString();
    new Setting(containerEl)
      .setName(t("Snapshot folder"))
      .setDesc(t("Enter the folder name where snapshots will be saved in the vault"))
      .setTooltip(t("Select a valid file name"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.settings.snapshotFolder)
          .setValue(this.plugin.settings.snapshotFolder)
          .onChange(async (value) => {
            if (!value.match(folderNamePattern)) {
              text.inputEl.addClass("warning");
            } else {
              text.inputEl.removeClass("warning");
              this.plugin.settings.snapshotFolder = value;
              await this.plugin.saveSettings();
              setSettingDesc();
            }
          });
        text.inputEl.addClass("vlc-bridge-text-input");
        return text;
      });

    new Setting(containerEl)
      .setName(t("Snapshot format"))
      .setDesc(t("Select the image format in which the snapshots will be saved"))
      .addDropdown((menu) => {
        menu
          .addOptions(snapshotExts)
          .setValue(snapshotExts[this.plugin.settings.snapshotExt])
          .onChange(async (value: "png" | "jpg" | "tiff") => {
            this.plugin.settings.snapshotExt = value;
            await this.plugin.saveSettings();
            setSettingDesc();
          });
      });

    new Setting(containerEl).setName("Syncplay").setHeading();
    const spPathToggleArr: ToggleComponent[] = [];
    const spCliCheck = new Setting(containerEl);
    if (this.plugin.spCliExist) {
      spCliCheck
        .setDesc(
          createFragment((el) => {
            MarkdownRenderer.render(this.app, `## ${t("{{1}} CLI command is available.", ["**`syncplay`**"])}\n`, el.createDiv(), "", this.plugin);
          })
        )
        .addButton((btn) => {
          btn.setWarning().setIcon("lucide-check-check").setDisabled(true);
        });
      if (Platform.isWin) {
        spCliCheck.addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.spCommandPath == "cli" || !this.plugin.settings.syncplayPath?.length)
            .setDisabled(this.plugin.settings.spCommandPath == "cli" || !this.plugin.settings.syncplayPath?.length)
            .onChange(async (value) => {
              toggle.setDisabled(value);
              if (value == true) {
                this.plugin.settings.spCommandPath = "cli";
                await this.plugin.saveSettings();
                spPathToggleArr.map((t) => {
                  if (t !== toggle) {
                    t.setValue(false);
                  }
                });
              } else {
                await this.plugin.saveSettings();
              }
              setSettingDesc();
            });
          spPathToggleArr.push(toggle);
        });
      }
    } else {
      spCliCheck
        .setDesc(
          createFragment((el) => {
            MarkdownRenderer.render(this.app, `## ${t("{{1}} CLI command is not installed on your system.", ["**`syncplay`**"])}\n`, el.createDiv(), "", this.plugin);
          })
        )
        .addButton((btn) => {
          btn
            .setIcon("lucide-unlink")
            .setDisabled(true)
            .setTooltip(t("{{1}} CLI command is not installed on your system.", [`'syncplay'`]));
        });
      if (Platform.isWin) {
        spCliCheck.addToggle((toggle) => {
          toggle.setDisabled(true).setValue(false);
        });
      }
    }

    if (Platform.isWin) {
      let selectSPDescEl: HTMLElement;
      let selectSPBtnEl: ButtonComponent;
      let spPathToggle: ToggleComponent;
      const selectSP = new Setting(containerEl)
        .setName(t("Syncplay path"))
        .setDesc(t("Select 'Syncplay.exe' from the folder where Syncplay is installed"))
        // auto-detect path
        .addButton((btn) => {
          btn.setButtonText(t("Try auto-detect")).onClick(async () => {
            // Source:
            // https://forums.powershell.org/t/getting-the-path-of-a-program/21447/11
            const findInstalledLocationCommand = `powershell.exe "Get-ItemProperty -Path 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object {$_.DisplayName -like 'syncplay'} | Select InstallLocation"`;
            try {
              const output = childProcess.execSync(findInstalledLocationCommand).toString();
              console.log("Detected Location:" + output);

              if (output && output.toLowerCase().contains("syncplay")) {
                const lastLine = output.trim().split("\n")?.pop()?.trim() as string;
                const installedPath = path.join(lastLine, "Syncplay.exe");
                this.plugin.settings.syncplayPath = installedPath;
                selectSPDescEl.innerText = installedPath;

                await this.plugin.saveSettings();
                spPathToggle.setValue(this.plugin.settings.spCommandPath == "spPath" && this.plugin.settings.syncplayPath?.length > 0);
                spPathToggle.setDisabled(this.plugin.settings.spCommandPath == "spPath" && this.plugin.settings.syncplayPath?.length > 0);
                if (this.plugin.settings.spCommandPath == "spPath") {
                  setSettingDesc();
                }
              } else {
                selectSPBtnEl.setWarning();
                new Notice(t("Failed to detect the installation location of {{1}}. Please try selecting it manually.", ["Syncplay"]));
              }
            } catch (err) {
              selectSPBtnEl.setWarning();
              new Notice(t("Failed to detect the installation location of {{1}}. Please try selecting it manually.", ["Syncplay"]));
              console.error(`Error: ${err.message}`);
            }
          });
        })
        // manually select
        .addButton((btn) => {
          selectSPBtnEl = btn;
          btn
            .setButtonText(t("Select Syncplay.exe"))

            .onClick(() => {
              window.electron.remote.dialog
                .showOpenDialog({
                  title: t("Select Syncplay.exe"),
                  properties: ["openFile"],
                  filters: [
                    {
                      name: "syncplay",
                      extensions: ["exe"],
                    },
                  ],
                })
                .then(async (result: { canceled: boolean; filePaths: string[] }) => {
                  console.log("Selected file:", result);
                  if (!result.canceled && result.filePaths.length) {
                    const file = result.filePaths[0];
                    this.plugin.settings.syncplayPath = file;
                    selectSPDescEl.innerText = file;
                    await this.plugin.saveSettings();
                    spPathToggle.setDisabled(this.plugin.settings.spCommandPath == "spPath" && this.plugin.settings.syncplayPath?.length > 0);
                    setSettingDesc();
                  }
                })
                .catch((err: Error) => {
                  console.log(err);
                });
            });
        })
        // toggle
        .addToggle((toggle) => {
          spPathToggle = toggle;
          toggle
            .setValue(this.plugin.settings.spCommandPath == "spPath" && this.plugin.settings.syncplayPath?.length > 0)
            .setDisabled(this.plugin.settings.spCommandPath == "spPath" || !this.plugin.settings.syncplayPath?.length)
            .onChange(async (value) => {
              toggle.setDisabled(value);
              if (value == true) {
                this.plugin.settings.spCommandPath = "spPath";
                await this.plugin.saveSettings();
                spPathToggleArr.map((t) => {
                  if (t !== toggle) {
                    t.setValue(false);
                  }
                });
              } else {
                await this.plugin.saveSettings();
              }
            });
          spPathToggleArr.push(toggle);
        });
      selectSPDescEl = selectSP.descEl.createEl("div").createEl("b", { text: this.plugin.settings.syncplayPath || "" });
    }

    syncplayArgEl = new Setting(containerEl).setName(t("Start Syncplay with plugin arguments")).addButton((btn) =>
      btn.setButtonText(t("Start Syncplay")).onClick(async () => {
        this.plugin.launchSyncplay();
      })
    );

    new Setting(containerEl).setName(t("Extra")).setHeading();

    copyUrlEl = new Setting(containerEl).setName(t("Copy VLC Web Interface link")).addButton((btn) =>
      btn.setButtonText(t("Copy to clipboard")).onClick(async () => {
        if (await isPortAvailable(this.plugin.settings.port)) {
          await navigator.clipboard.writeText(`http://:${this.plugin.settings.password}@localhost:${this.plugin.settings.port}/`);
          new Notice(t("Copied to clipboard"));
        } else {
          new Notice(t("The port you selected is not usable, please enter another port value"));
        }
      })
    );
    copyCommandEl = new Setting(containerEl).setName(t("Copy command line code")).addButton((btn) =>
      btn.setButtonText(t("Copy to clipboard")).onClick(async () => {
        if (await isPortAvailable(this.plugin.settings.port)) {
          await navigator.clipboard.writeText(this.plugin.vlcExecOptions("vlc").join(" "));
          new Notice(t("Copied to clipboard"));
        } else {
          new Notice(t("The port you selected is not usable, please enter another port value"));
        }
      })
    );

    setSettingDesc();
    updateTemplatePreviews();
    updateTranscriptTemplatePreview();
  }
  hide() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VB);
    if (leaves.length > 0 && this.lasttranscriptTemplate !== this.plugin.settings.transcriptTemplate) {
      new Notice(t("You have changed your transcript template. To update the template used in currently open transcript views, use the ‘Reload’ button."), 60 * 1000);
    }

    const updateSnapshotFolder = async () => {
      if ((await this.plugin.app.vault.adapter.exists(this.lastSnapshotPath)) && !(await this.plugin.app.vault.adapter.exists(this.plugin.settings.snapshotFolder))) {
        await this.plugin.app.vault.adapter.rename(this.lastSnapshotPath, this.plugin.settings.snapshotFolder);
      } else {
        await this.plugin.app.vault.adapter.mkdir(this.plugin.settings.snapshotFolder);
      }
      this.lastSnapshotPath = this.plugin.settings.snapshotFolder;
    };
    updateSnapshotFolder();
  }
}
