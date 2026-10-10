# Claude-Spotter

![version](https://img.shields.io/badge/version-0.1.1-blue)

A mod for the Claude Code CLI that shows what each running subagent runs on. Claude Code's agent list names a subagent and its task but not its model, effort or context. Claude-Spotter lists them under the prompt, just above that list, and raises a toast when one starts.

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────╯
  esc to interrupt
  [Opus 5.5 ·high] · mods/main · ctx (1M) ▰▰▱▱▱ 29% · 5h (2h13m) █░░░░ 10% · wk (6d17h) █░░░░ 1%
  subagents
   ├ Sonnet 5.5 ·medium · Explore · ctx (200K) ▰▱▱▱▱ 12%
   └ Haiku 5.5 ·low · general-purpose · ctx (200K) ▰▰▱▱▱ 38%
```

## Features

- **A row per live subagent** under a small `subagents` title, in a tree: the model, the effort, the agent's type and its context window, with a bar and percent.
- **A toast on spawn:** `Claude-Spotter: Explore → Sonnet 5.5 ·medium`, a moment after the subagent starts, once its first request has told its effort.
- **Bar styles** (`/spotter`): the same 16 styles and widths as [claudepeeker](https://github.com/AndreaChiacchia/claude-peeker).
- **Colors follow the fill:** green below 50%, yellow from 50%, red from 80%.
- **Quieter than the status line:** the model and effort use claudepeeker's amber and cyan, muted and not bold, so the main session's line stays the brightest.
- **Works with claudepeeker:** its status line stays right under the hint line, and the subagent rows go below it.

## Install

**Claude Code CLI only.** You also need Claude Code 2.1.296 or later.

Load it in every session by adding the folder to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (separate several folders with `;` on Windows, `:` elsewhere):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<you>\\projects\\mods\\claudespotter"
  }
}
```

Or load it for a single session with `claude --plugin-dir <path to this folder>`.

## Usage

| Command | What it does |
|---|---|
| `/spotter` | Open the bar style panel |

The panel previews the bar. Click `‹` or `›` to step its style or width.

## How it works

- **Model and effort:** read from each request a subagent sends (`turn.step`), so they're what it actually runs on. Until its first request, the row shows the model the spawn resolved.
- **Context:** the input, cache-read and cache-creation tokens of the subagent's latest response.
- **Which subagents:** the ones `$.agent.list()` reports as pending, running or waiting, teammates left out. A row leaves when its subagent ends.
- **Your choices:** the bar style and width are kept in the mod's own store, so they last across sessions.

## Limitations

- **Above the agent list, not in it.** The mod API has no hook into Claude Code's own agent list, so the rows go in the hint line slot just above it.
- **The context window is a best guess.** The API reports the window for the main model only. A subagent on a `[1m]` model counts as 1M, one on the main session's model gets the main window, and any other gets 200K.

## Development

```
claude plugin validate .
claude plugin test .
```

| Path | Contents |
|---|---|
| `hooks/register.tsx` | the mod: subagent tracking, the rows under the hint, the toast, the `/spotter` panel |
| `hooks/format.ts` | the rows as colored segments: model names, effort, token counts, window sizes |
| `hooks/styles.ts` | the bar styles and the stored preference |
| `types/index.d.ts` | the mod's state contract |
| `tests/` | tests for the rows, the toast, the panel and the figures |

## License

MIT, see [LICENSE](LICENSE).
