# @pi-kit/rewind

Rewind code and conversation to an earlier prompt in the
[Pi coding agent](https://pi.mariozechner.at/). Records file bytes around Pi's
built-in `write` and `edit` tools and restores them when you revisit a point
in the session. No configuration and no runtime dependencies.

```sh
pi install npm:@pi-kit/rewind
```

Use `/rewind` to choose a user prompt on the current branch, newest first.
It opens Pi's tree navigation and puts the selected prompt back in the editor.
Wait for the response to finish before using `/rewind`.

Use `/tree` (or Pi's double Escape on an empty prompt) to select any point in
the session. After Pi's summary choice, if code differs from that point,
rewind offers:

| Choice | Effect |
|---|---|
| Restore code and conversation | Move the conversation, then restore code once the move succeeds |
| Restore conversation only | Move the conversation and keep current files |
| Restore code only | Restore files and stay at the current conversation point |
| Cancel / Escape | Keep both code and conversation |

Use `/fork` (or double Escape when Pi's `doubleEscapeAction` is `"fork"`) to
branch the conversation. If code differs, choose **Restore code**, **Keep
current code**, or **Cancel**. Restore code applies before the fork; if the
fork itself then fails, the files have already been restored. A fork with
code changes waits for an idle agent: rewind cancels it during an active
response so an in-flight edit cannot overwrite the restore.

In the terminal UI, pressing Escape twice within 500 ms while idle clears a
non-empty prompt. The second press is consumed; a third press does not open
the tree. Empty prompts pass through to Pi. Clearing does not add the text
to input history, so it cannot be recalled from history. Pi clears its Bash
mode (`!` prefix) with a single Escape.

Files changed outside the recorded tool calls require one overwrite
confirmation listing all conflicts. Declining keeps those files. Restores
preserve existing file modes and use a temporary file plus rename; newly
created files are removed when rewinding before their creation. Directories
remain. Each restore reports restored files and any skipped paths.

## Limits

- Only built-in `write` and `edit` calls are captured. Bash changes, custom
  tools, and subagent edits are not tracked; this extension has no subagent
  integration.
- Symlinks and files with more than one hard link are skipped on restore.
- A missing snapshot or filesystem error skips that path and reports the
  reason. Capture failures let the tool run and warn once per path per session.
- Menus require a UI. Headless runs still capture edits, but do not offer
  restores.
- Records survive session resume and include abandoned branches within the
  same session. A forked session contains only its forked branch, so it cannot
  see records on the parent session's abandoned branches.
- After restoring code only or keeping code while moving the conversation,
  a later restore can ask about conflicts caused by rewind itself.
- Pi's `/tree` does nothing when selecting the current leaf, so it cannot
  offer a restore there. Use `/rewind` to revisit the current prompt.
- Selecting an internal rewind record in `/tree`'s all filter can expose an
  intermediate state from parallel edits; select a prompt for a stable point.

## Snapshots

Snapshots live in `<agentDir>/pi-kit-rewind/blobs`, named by SHA-256 of their
bytes. The directory is created with mode `0700`, blobs with mode `0600`.
Reusing a blob refreshes its timestamp. On session start a best-effort sweep
removes blobs older than 30 days. Restoring a swept blob skips the file and
reports `snapshot missing`. There is no retention setting.

Node 22.19 or newer. Pi supplies the coding-agent and terminal-UI peers.

MIT
