<div align="center">
	
# Obsidian VLC Bridge
	
[![GitHub Release](https://img.shields.io/github/v/release/zuluwi/obsidian-vlc-bridge?style=for-the-badge&logo=obsidian&labelColor=%237c3aed&color=%23e7e6e3)](https://github.com/zuluwi/obsidian-vlc-bridge/releases/latest)
[![GitHub License](https://img.shields.io/github/license/zuluwi/obsidian-vlc-bridge?style=for-the-badge&labelColor=%23eb0029&color=%23e7e6e3)](https://github.com/zuluwi/obsidian-vlc-bridge/blob/master/LICENSE)

</div>

This plugin

- Starts VLC Player with the [Web Interface](https://wiki.videolan.org/Documentation:Modules/http_intf/#VLC_2.0.0_and_later) active and opens video addresses written in Obsidian URI format at the specified time,
- Pastes timestamped link or snapshot from existing video into note
- Allows you to control the player by sending [request](https://code.videolan.org/videolan/vlc-3.0/-/blob/master/share/lua/http/requests/README.txt) to the VLC Web Interface with commands,

so you can take notes from the video without losing focus from the Obsidian Editor.

https://github.com/zuluwi/obsidian-vlc-bridge/assets/111116092/296c6878-232f-48ee-82a4-dd5673ddb131

## Installation

This plugin is not an official community plugin, so you can install it manually or using the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin

### Manual

1. Download [Latest version](https://github.com/zuluwi/obsidian-vlc-bridge/releases/latest)
2. Create a new folder at `<vault_location>/.obsidian/plugins`
3. Move the downloaded `main.js` and `manifest.json` files to this folder
4. Turn off `Settings → Community plugins → Restricted mode` and enable **VLC Bridge** in `Installed plugins`.

### With BRAT

1. Install and activate **BRAT** by opening the `obsidian://show-plugin?id=obsidian42-brat` link or from `Settings → Community plugins → Browse`
2. Install **VLC Bridge** by using the `Add a beta plugin for testing` command and then entering `zuluwi/obsidian-vlc-bridge` or by opening the link `obsidian://brat?plugin=zuluwi/obsidian-vlc-bridge`

## Usage

> [!important]
> To use the plugin, you must first select `vlc.exe` in the plugin settings from the location where VLC Player is installed and then set a port number

### Opening Video

- Using the `Select a file to open with VLC Player` command or by clicking on the icon in the sidebar
- By clicking on a timestamp link you created with the plugin
- or by dragging and dropping a video to the player you have already opened with the plugin

you can control VLC Player with the plugin for videos you open in these ways.

> [!tip]
> If you want to be able to use the plugin when you open VLC yourself on your computer, you must save the parameters you set in the plugin settings in the VLC preferences
>
> 1. Open `Tools → Preferences → select "All" in "Show Settings" at the bottom-left corner → Interface → Main interfaces` and check `Web`, then in `Main interfaces → Lua` set the password to `vlcPassword` in the `Lua HTTP` header
> 2. `select "Simple" in "Show Settings" at the bottom-left corner → Video → Video snapshots` and set `Directory` to the folder you set in the plugin settings
> 3. VLC Player uses port `8080` and this cannot be changed in the preferences, so you have to set the port to `8080` in the plugin settings.

### Add Timestamp Link

Open the command palette (Ctrl+P) and use the command `Paste timestamped link of current video` to paste the timestamped link of the current video where the cursor is in the editor.

Link Syntax:

```
[{{Timestamp Linktext}}](obsidian://vlcBridge?mediaPath=<File URI>&subPath=<File URI or Absolute Path>&subDelay=<in seconds>&timestamp=<in seconds or percentage value>)
```

> [!tip]
>
> - Check `Pause video while pasting timestamp` in Settings
> - You can add delay with `Timestamp offset` setting
> - In the `Link templates` settings you can set `Timestamp linktext` and a template for how to paste the link

#### Include Subtitle Link

If you want to include the subtitle link in the video link, instead of dragging the subtitle to the VLC Player, use the `Add subtitles` command to select the file and add it to the video, otherwise the plugin will not be able to access the existing subtitle in the player.

### Add Snapshot Embed

Open the command palette (Ctrl+P) and use the `Take and paste snapshot from video` command to paste a snapshot of the current video with the timestamped link where the cursor is in the editor.

> [!tip]
>
> - Check `Pause video while pasting snapshot` in Settings
> - If you want to open the exact frame in the snapshot with the timestamp link, enable `Use percentile position instead of seconds as timestamp value in the link` in Settings
> - In the `Link templates` settings you can set `Snapshot linktext` and a template for how to paste the snapshot embed

### Running Syncplay with plugin arguments

[Syncplay](https://github.com/Syncplay/syncplay?tab=readme-ov-file#syncplay) is an application that connects to an online server to open the preferred player and synchronizes the connected players. By selecting `Syncplay.exe` from the plugin settings and clicking the **Start Syncplay** button, you can start Syncplay so that the plugin interacts with the VLC Player that the app will open.

> [!tip]
> Create a shortcut with the url `obsidian://vlcBridge-runSyncplay` to open Obsidian and then Syncplay

## Attributions

- [Media Extended](https://github.com/PKM-er/media-extended)
- [Obsidian VLC Control](https://github.com/prehensileBBC/obsidan-vlc-control)
- [Syncplay](https://github.com/Syncplay/syncplay)
- [Obsidian Kanban](https://github.com/mgmeyers/obsidian-kanban) (for localization handler)
