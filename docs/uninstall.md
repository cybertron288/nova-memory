# Uninstall Nova

Do these steps in order. Steps 3 and 4 delete your data permanently.

## 1. Quit Nova

Open the menu bar glyph and choose **Quit Nova**. This stops the daemon and
capture too.

If the menu does not respond:

```sh
pkill -x NovaShell
```

If you started a daemon in a terminal yourself, stop it with Control-C in that
terminal.

## 2. Remove the MCP entries

Claude Code:

```sh
claude mcp remove nova -s user
```

Claude Desktop: open
`~/Library/Application Support/Claude/claude_desktop_config.json`, delete the
`"nova"` entry under `"mcpServers"`, save, and restart Claude Desktop.

Remove Nova from any other MCP client you connected.

## 3. Delete the data and the log

```sh
rm -rf ~/Library/Application\ Support/Nova ~/Library/Logs/Nova
```

This deletes the encrypted store, the control socket and the log.

## 4. Delete the encryption keys

```sh
security delete-generic-password -s dev.nova.keys -a db
security delete-generic-password -s dev.nova.keys -a field
```

**Warning:** without these two keychain items, the store cannot be read by
anyone, including you. If you want to keep a copy of
`~/Library/Application Support/Nova/memory.db` for later, keep these items
too. If you already deleted the store in step 3, delete the keys.

## 5. Delete the app

The app is `build/Nova.app` inside your clone. Delete the clone to remove the
app, the daemon and your `.env`:

```sh
rm -rf /path/to/nova
```

`.env` holds your API keys. If you keep the clone, delete `.env` or revoke the
keys with your provider.

If you copied `Nova.app` anywhere else, such as `/Applications`, delete that
copy too.

If you added Nova to System Settings → General → Login Items, remove it there.

## 6. Reset the permissions

```sh
tccutil reset Accessibility io.github.cybertron288.nova
tccutil reset ScreenCapture io.github.cybertron288.nova
```

Nova then disappears from System Settings → Privacy & Security →
Accessibility and Screen Recording. You can also remove it there by hand with
the minus button.

## 7. Delete the signing identity (optional)

The build script created a self-signed code-signing identity named "Nova Dev"
in your login keychain. Nothing else uses it. To delete it:

```sh
security delete-identity -c "Nova Dev"
```

Or open Keychain Access, select the login keychain, search for "Nova Dev",
and delete the certificate and its private key.

If you plan to build Nova again later, keep it. A new identity means macOS
asks for the Accessibility permission again.

## 8. Remove the build tools (optional)

Nova installed nothing system-wide. If you installed these only for Nova, you
can remove them:

```sh
brew uninstall sqlcipher
```

Bun and the Xcode command line tools are general tools. Remove them only if
nothing else needs them.

## What uninstalling cannot undo

- Text your AI provider already received. Its retention policy applies.
- Search results and loops an AI app already received over MCP. They stay in
  that app's conversation history.
