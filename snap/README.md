# snap

A Claude Code mod. Type `/snap`, drag a box on the screen, and the screenshot goes into your next message.

## How it works

1. `/snap` runs Spectacle in region mode: `spectacle --region --background --nonotify --output <file>`.
2. The file lands in `~/.cache/claude-snaps/snap-<YYYYMMDD-HHMMSS>.png`.
3. The mod inserts `@<path> ` at the cursor in your prompt box. Claude Code reads an @-mentioned image file.
4. Escape, no file, or a non-zero exit shows the toast `Snap cancelled` and changes nothing. A missing Spectacle shows `Snap needs Spectacle (KDE)`.

A plugin cannot attach an image to the draft itself (the types only describe attachments of a prompt already sent), so the mod uses the @path text.

You have 2 minutes to drag the box.

## Requirements

KDE with Spectacle (`/usr/bin/spectacle`).

## Develop

    claude plugin validate .
    tsc -p .
    claude plugin test .
