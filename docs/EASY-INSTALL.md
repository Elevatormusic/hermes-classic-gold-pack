# Easy folder install

Use these steps if you do not want to use a terminal. This method installs the
Classic Gold theme and status bar. It does not install the optional pets.

## Before you start

Use the ZIP attached to the latest GitHub release. Do not copy the source-code
folder from GitHub. The release ZIP contains a prepared `plugin.js` file.

If you installed Classic Gold with `node install.mjs`, do not use this folder
method to update it. Use the normal installer again so its safety records stay
correct.

Would you rather let an AI agent do the work? Open
[`AI-AGENT-PROMPTS.md`](AI-AGENT-PROMPTS.md), copy the prompt for your task, and
paste it into an AI coding agent that can access your computer.

## Windows

1. Download `Hermes-Classic-Gold-v1.2.0.zip` from the latest release.
2. Right-click the ZIP and select **Extract All**.
3. Fully quit Hermes Desktop. Check the system tray too.
4. Press `Windows key + R`.
5. Enter `%LOCALAPPDATA%\hermes` and select **OK**.
6. Copy the extracted `desktop-plugins` and `plugins` folders into the open
   `hermes` folder.
7. If Windows asks, select **Merge folders** and **Replace files**.
8. Start Hermes Desktop.
9. Open **Settings > Plugins** and enable **Classic Gold**.
10. Fully quit and start Hermes Desktop one more time. This restart loads the
    telemetry backend.
11. Open **Settings > Appearance** and select **Classic Hermes**.

If the theme does not appear, open the Command Palette and run **Reload desktop
plugins**. Then check **Settings > Appearance** again.

## macOS and Linux profile folders

The copy steps are the same. Copy both release folders into the Hermes profile
that contains `config.yaml`.

- macOS default: `~/Library/Application Support/hermes`
- Linux default: `~/.local/share/hermes`

If your profile is in another location, use that profile. Do not guess when you
have more than one Hermes profile.

## Update a folder install

Fully quit Hermes. Download the new release ZIP and replace only these two
folders:

```text
desktop-plugins/classic-gold/
plugins/classic-gold/
```

Start Hermes again. Your Classic Gold settings remain in Hermes private plug-in
storage.

## Remove a folder install

These steps apply only to an install made with this folder-copy guide.

1. Select another theme in **Settings > Appearance**.
2. Disable **Classic Gold** in **Settings > Plugins**.
3. Fully quit Hermes.
4. Delete only these two `classic-gold` folders from the Hermes profile:

   ```text
   desktop-plugins/classic-gold/
   plugins/classic-gold/
   ```

5. Start Hermes.

Do not delete the full `desktop-plugins`, `plugins`, or Hermes profile folder.
