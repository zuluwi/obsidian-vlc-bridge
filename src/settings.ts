import { App, Notice, PluginSettingTab, Setting, MarkdownRenderer, SliderComponent, TextComponent } from "obsidian";
import VLCBridgePlugin from "./main";
import { t } from "./language/helpers";
import { currentConfig } from "./vlcHelper";
import isPortReachable from "is-port-reachable";

declare module "obsidian" {
  interface DataAdapter {
    getFullRealPath(arg: string): string;
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
  showSidebarIcon: boolean;
  timestampLinktext: string;
  timestampLinkTemplate: string;
  snapshotLinktext: string;
  snapshotLinkTemplate: string;
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
  showSidebarIcon: true,
  timestampLinktext: "{{timestamp}}",
  timestampLinkTemplate: "{{timestamplink}} ",
  snapshotLinktext: "{{filename}} {{timestamp}}",
  snapshotLinkTemplate: "{{timestamplink}} \n{{snapshot}} \n",
};

const snapshotExts: {
  png: "png";
  jpg: "jpg";
  tiff: "tiff";
} = {
  png: "png",
  jpg: "jpg",
  tiff: "tiff",
};

export class VBPluginSettingsTab extends PluginSettingTab {
  plugin: VLCBridgePlugin;

  constructor(app: App, plugin: VLCBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const isPortAvailable = (port: number) => {
      return new Promise<boolean>(async (resolve) => {
        var isPortInUse = await isPortReachable(port, { host: "localhost" });
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
    let copyArgEl: Setting;

    const splittedPath = () => {
      let dirPathArg = "--snapshot-path=" + this.plugin.app.vault.adapter.getFullRealPath(this.plugin.settings.snapshotFolder);
      return {
        1: `${dirPathArg
          .split(" ")
          .map((str) => `'${str}'`)
          .join(", ")}`,
        2: `'${dirPathArg}'`,
      };
    };

    const setSettingDesc = () => {
      syncplayArgEl.setDesc(`"${this.plugin.settings.syncplayPath}" --player-path "${this.plugin.settings.vlcPath}" -- ${this.plugin.vlcExecOptions().join(" ")}`);
      copyUrlEl.setDesc(`http://:${this.plugin.settings.password}@localhost:${this.plugin.settings.port}/`);
      copyCommandEl.setDesc(`"${this.plugin.settings.vlcPath}" ${this.plugin.vlcExecOptions().join(" ")}`);

      tsLinkTextSetting.setDesc(
        createFragment((el) => {
          MarkdownRenderer.render(
            this.app,
            `## \\[ **${this.plugin.settings.timestampLinktext}** ]( {{vlcBridge URI}} ) \n#### ${t("Placeholders")} \n- \`{{filename}}\` \n- \`{{timestamp}}\` \n`,
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
            `## \\!\\[[ {{${t("Snapshot Path")}}} | **${this.plugin.settings.snapshotLinktext}** ]] \n#### ${t("Placeholders")} \n- \`{{filename}}\` \n- \`{{timestamp}}\` \n`,
            el.createDiv(),
            "",
            this.plugin
          );
        })
      );

      // copyArgEl.setDesc(`${this.plugin.vlcExecOptions().join(" ").replace(/["]/g, "")}`);
      // if (/\s/.test(this.plugin.app.vault.adapter.getFullRealPath(this.plugin.settings.snapshotFolder))) {
      //   MarkdownRenderer.render(
      //     this.app,
      //     `> [!warning]\n> ${t("syncplay argument instructions").replace("#1#", splittedPath()[1]).replace("#2#", splittedPath()[2])}`,
      //     copyArgEl.descEl,
      //     "",
      //     this.plugin
      //   );
      // }

      // .createDiv()
      // .createEl("code", { text: `${splittedPath()}` });

      //
    };

    var selectVLCDescEl: HTMLElement;
    var selectVLC = new Setting(containerEl)
      .setName(t("VLC Path"))
      .setDesc(t("Select 'vlc.exe' from the folder where VLC Player is installed"))
      .addButton((btn) => {
        btn.setButtonText(t("Select vlc.exe")).onClick(() => {
          const input = document.createElement("input");
          input.setAttribute("type", "file");
          input.accept = ".exe";
          input.onchange = async (e: Event) => {
            var files = (e.target as HTMLInputElement)?.files as FileList;
            for (let i = 0; i < files.length; i++) {
              var file = files[i];

              this.plugin.settings.vlcPath = file.path;
              selectVLCDescEl.innerText = file.path;
              await this.plugin.saveSettings();
              setSettingDesc();

              input.remove();
            }
          };

          input.click();
        });
      });
    selectVLCDescEl = selectVLC.descEl.createEl("div").createEl("b", { text: this.plugin.settings.vlcPath || "" });

    new Setting(containerEl)
      .setName(t("Port"))
      .setDesc(t("Enter a port number between 1 and 65535 for the server that will be opened to control VLC Player"))
      .addText(async (text) => {
        text
          .setPlaceholder(this.plugin.settings.port.toString())
          .setValue(this.plugin.settings.port.toString())
          .onChange(async (value) => {
            if (isNaN(Number(value)) || 65535 < Number(value) || 1 > Number(value)) {
              text.inputEl.style.borderColor = "red";
            } else if (!(await isPortAvailable(Number(value)))) {
              text.inputEl.style.borderColor = "red";
              new Notice(t("The port you selected is not usable, please enter another port value"));
            } else {
              text.inputEl.style.borderColor = "currentColor";
              this.plugin.settings.port = Number(value);
              await this.plugin.saveSettings();
              setSettingDesc();
            }
          });
        // var portCheck = await getPort({ port: this.plugin.settings.port });

        if (!(await isPortAvailable(this.plugin.settings.port))) {
          text.inputEl.style.borderColor = "red";
          new Notice(t("The port you selected is not usable, please enter another port value"));
        }
      });

    new Setting(containerEl).setName(t("Show 'open video' icon in the sidebar")).addToggle((toggle) => {
      toggle.setValue(this.plugin.settings.showSidebarIcon).onChange(async (value) => {
        this.plugin.settings.showSidebarIcon = value;
        await this.plugin.saveSettings();
        this.plugin.setSidebarIcon();
      });
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
        .setName(t("Timestamp Offset"))
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
            if (!Number.isInteger(Number(value))) {
              text.inputEl.style.borderColor = "red";
            } else {
              text.inputEl.style.borderColor = "currentColor";
              this.plugin.settings.timestampOffset = Number(value);
              await this.plugin.saveSettings();
              tsOffsetSlider.setValue(this.plugin.settings.timestampOffset);
            }
          });

          text.inputEl.style.width = "5em";
          return text;
        });
    }

    containerEl.createEl("h1", { text: t("Link Templates") });

    containerEl.createEl("h2", { text: t("Timestamp Link") });

    let tsLinkTextSetting = new Setting(containerEl)
      .setName(t("Timestamp Linktext"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.settings.timestampLinktext)
          .setValue(this.plugin.settings.timestampLinktext)
          .onChange(async (value) => {
            this.plugin.settings.timestampLinktext = value;
            await this.plugin.saveSettings();
            setSettingDesc();
          });
        text.inputEl.style.width = "20em";
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
      .setName(t("Timestamp Template"))
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
            this.plugin.saveSettings();
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

    containerEl.createEl("h2", { text: t("Snapshot Embed") });

    let ssLinkTextSetting = new Setting(containerEl)
      .setName(t("Snapshot Linktext"))
      .addText((text) => {
        text
          .setPlaceholder(this.plugin.settings.snapshotLinktext)
          .setValue(this.plugin.settings.snapshotLinktext)
          .onChange(async (value) => {
            this.plugin.settings.snapshotLinktext = value;
            await this.plugin.saveSettings();
            setSettingDesc();
          });
        text.inputEl.style.width = "20em";
        return text;
      })
      .addExtraButton((button) =>
        button.setIcon("lucide-rotate-ccw").onClick(async () => {
          this.plugin.settings.snapshotLinktext = DEFAULT_SETTINGS.snapshotLinktext;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    new Setting(containerEl)
      .setName(t("Snapshot Template"))
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
            this.plugin.saveSettings();
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

    containerEl.createEl("h1", { text: t("Seeking Amounts") });

    new Setting(containerEl)
      .setName(t("Normal Seek Amount (in seconds)"))
      .setDesc(t("Set the seek amount for 'Seek forward/backward' commands"))
      .addSlider((slider) => {
        slider
          .setLimits(1, 60, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.normalSeek)
          .onChange((value) => {
            this.plugin.settings.normalSeek = value;
            this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("Long Seek Amount (in seconds)"))
      .setDesc(t("Set the seek amount for 'Long seek forward/backward' commands"))
      .addSlider((slider) => {
        slider
          .setLimits(5, 10 * 60, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.largeSeek)
          .onChange((value) => {
            this.plugin.settings.largeSeek = value;
            this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h1", { text: t("Snapshot") });

    var folderNamePattern = /^[A-Za-z0-9][^\\\/\<\>\"\*\:\|\?]*$/gi;
    new Setting(containerEl)
      .setName(t("Snapshot folder"))
      .setDesc(t("Enter the folder name where snapshots will be saved in the vault"))
      .setTooltip(t("Select a valid file name"))
      .addText((text) =>
        text
          .setPlaceholder(this.plugin.settings.snapshotFolder)
          .setValue(this.plugin.settings.snapshotFolder)
          .onChange(async (value) => {
            if (!value.match(folderNamePattern)) {
              text.inputEl.style.borderColor = "red";
            } else {
              text.inputEl.style.borderColor = "currentColor";
              if (await this.plugin.app.vault.adapter.exists(this.plugin.settings.snapshotFolder)) {
                this.plugin.app.vault.adapter.rename(this.plugin.settings.snapshotFolder, value);
              } else {
                this.plugin.app.vault.adapter.mkdir(value);
              }
              this.plugin.settings.snapshotFolder = value;
              await this.plugin.saveSettings();
              setSettingDesc();
            }
          })
      );

    new Setting(containerEl)
      .setName(t("Snapshot Format"))
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

    containerEl.createEl("h1", { text: "Syncplay" });

    var selectSPDescEl: HTMLElement;
    var selectSP = new Setting(containerEl)
      .setName(t("Syncplay Path"))
      .setDesc(t("Select 'Syncplay.exe' from the folder where Syncplay is installed"))
      .addButton((btn) => {
        btn
          .setButtonText(t("Select Syncplay.exe"))

          .onClick(() => {
            const input = document.createElement("input");
            input.setAttribute("type", "file");
            input.accept = ".exe";
            input.onchange = async (e: Event) => {
              var files = (e.target as HTMLInputElement)?.files as FileList;
              for (let i = 0; i < files.length; i++) {
                var file = files[i];

                this.plugin.settings.syncplayPath = file.path;
                selectSPDescEl.innerText = file.path;
                await this.plugin.saveSettings();
                setSettingDesc();

                input.remove();
              }
            };

            input.click();
          });
      });
    selectSPDescEl = selectSP.descEl.createEl("div").createEl("b", { text: this.plugin.settings.syncplayPath || "" });

    syncplayArgEl = new Setting(containerEl).setName(t("Start Syncplay with plugin arguments")).addButton((btn) =>
      btn.setButtonText(t("Start Syncplay")).onClick(async () => {
        this.plugin.launchSyncplay();
      })
    );

    containerEl.createEl("h1", { text: t("Extra") });

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
          await navigator.clipboard.writeText(`"${this.plugin.settings.vlcPath}" ${this.plugin.vlcExecOptions().join(" ")}`);
          new Notice(t("Copied to clipboard"));
        } else {
          new Notice(t("The port you selected is not usable, please enter another port value"));
        }
      })
    );
    // copyArgEl = new Setting(containerEl).setName(t("Copy arguments for starting VLC (for Syncplay)")).addButton((btn) =>
    //   btn.setButtonText(t("Copy to clipboard")).onClick(async () => {
    //     if (await isPortAvailable(this.plugin.settings.port)) {
    //       // await navigator.clipboard.writeText(`${this.plugin.vlcExecOptions().join(" ").trim().replace(/["]/g, "")}`);
    //       await navigator.clipboard.writeText(`${this.plugin.vlcExecOptions().join(" ").trim()}`);
    //       new Notice(t("Copied to clipboard"));
    //     } else {
    //       new Notice(t("The port you selected is not usable, please enter another port value"));
    //     }
    //   })
    // );
    setSettingDesc();

    //
  }
}
