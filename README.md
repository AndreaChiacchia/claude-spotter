# Claude-Spotter

![version](https://img.shields.io/badge/version-0.4.1-blue)

A mod for the Claude Code CLI that shows what each running subagent runs on. Claude Code's agent list names a subagent and its task but not its model, effort or context. Claude-Spotter lists them under the prompt, just above that list, and raises a toast when one starts and another when it ends.

```
╭──────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                    │
╰──────────────────────────────────────────────────────────────────────────────────────╯
  esc to interrupt
  [Opus 5.5 ·high] · mods/main · ctx (1M) ▰▰▱▱▱ 29% · 5h (2h13m) █░░░░ 10% · wk (6d17h) █░░░░ 1%
  subagents
   ├ ◐ Sonnet 5.5 ·medium · Explore · ctx (1M) ▰▱▱▱▱ 12% · 120K · 1m12s
   ├ ◐ Opus 5.5 ·high · Plan · ctx (1M) ▰▰▱▱▱ 31% · 310K · 14s
   └ ● Haiku 5.5 ·low · general-purpose · ctx (1M) ▰▰▱▱▱ 38% · 380K ✦ done · 5s
```

## Features

- **A row per live subagent** under a small `subagents` title, in a tree: a state dot, the model, the effort, the agent's type, its context window with a bar and percent, its context tokens and the time since it spawned.
- **A dot for each state:** `◌` pending, a spinning `◐ ◓ ◑ ◒` running (claudecharter's and claudeticker's agent spinner, a step every 0.2 s in Lively), a steady `●` dimmed half-way to gray waiting (claudepeeker's dim dot), all in lavender. With Motion off the running dot is a still `◐`. A finished row's dot is gray.
- **A finish:** a subagent that ends shows ` ✦ done · 42s` in place of its time for 2 seconds, then leaves. A stopped one reads `✗ stopped`, a failed one `✗ failed`.
- **A finish toast:** `Claude-Spotter: Explore done · 42s · 63K`, once the subagent ends.
- **A toast on spawn:** `Claude-Spotter: Explore → Sonnet 5.5 ·medium`, a moment after the subagent starts, once its first request has told its effort.
- **Motion** (setting `motion`): Lively (default), Subtle or Off. The bars glint when they change: a warm sweep runs left to right when context rises, an icy one right to left when it falls, and the emptied cells fade. The fill grows smoothly and blends its color, and the percent rolls to its new value with the changed digits flashing. Rising past 50% or 80% pulses the bar, and in Lively the dot pulses red past 80%. A compaction drains the bar and shows `↻ −40%` for a moment. A bar that appears after the first draw fills in from empty. Subtle has softer glints, no sparkles, and a spinner that steps once a second.
- **Tool calls:** each tool a subagent calls flashes its name at the end of its row, `‹Grep›`, for a moment, when the row has room.
- **Bar styles** (settings `barStyle`, `barWidth`): the same 17 styles and widths as [claudepeeker](https://github.com/AndreaChiacchia/claude-peeker), claudeticker's meter styles among them.
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
| `/spotter` | Say where the settings are (`/config`) |
| `/spotter demo` | Play a 20-second tour of the row effects with three made-up subagents |
| `/spotter demo stop` | End the demo; the real subagents come back |

The demo uses your Motion choice (with Off the figures change without effects) and goes back to your real subagents when it ends. It raises no toasts and saves nothing.

## Settings

Set them in `/config`, or in settings under `pluginConfigs.claudespotter`. A change applies at once.

| Setting | Values (default first) | Example |
|---|---|---|
| `barStyle` | `parallelogram`, `blocks`, `shade`, `solid`, `smooth`, `smooth-bare`, `line`, `heavy`, `dots`, `squares`, `diamonds`, `braille`, `ascii`, `arrow`, `pie`, `spark`, `none` | each row's bar: `▰▰▱▱▱` / `█░░░░` / `━━━━━` |
| `barWidth` | `5`, `3`, `4`, `6`, `8`, `10`, `12`, `15`, `20` | how many cells each bar takes (pie, spark and none ignore it) |
| `motion` | `lively`, `subtle`, `off` | glints, growth and rolling figures / the same, softer / still rows |

## How it works

- **Model and effort:** read from each request a subagent sends (`turn.step`), so they're what it actually runs on. Until its first request, the row shows the model the spawn resolved.
- **Context:** the input, cache-read and cache-creation tokens of the subagent's latest response, as a percent of its window and as a token count.
- **Time:** counted from when the spawn settled.
- **Which subagents:** the ones `$.agent.list()` reports as pending, running or waiting, teammates left out. A finished subagent stays for 2 seconds with its finish mark, then its row leaves. A subagent that runs again becomes a live row again.
- **Painting:** with Motion on, each row is three small cell grids (the dot, the bar and the tail) repainted 20 times a second while something moves in them, and 5 times a second while only the spinner and the elapsed time do. Only the pieces that changed are sent. Off, and any surface but the terminal, draws the plain text rows instead.
- **Your choices:** settings in `/config`, kept by Claude Code in settings.json, so they last across sessions, `/clear` and `/resume`.

## Limitations

- **Above the agent list, not in it.** The mod API has no hook into Claude Code's own agent list, so the rows go in the hint line slot just above it.
- **Effects only in the terminal.** Off and the other surfaces draw the plain rows, and so does a terminal that keeps refusing the drawing. The elapsed time still updates once a second on the plain rows.
- **The context window is a best guess.** The API reports the window for the main model only. A subagent on a `[1m]` model counts as 1M, one on the main session's model gets the main window, one on an Opus, Fable, Sonnet or Haiku model gets 1M, and any other gets 200K. A subagent whose tokens pass the window it was given counts as 1M.

## Development

```
npx -y -p typescript@5.6.3 tsc -p .
claude plugin validate .
claude plugin test .
```

| Path | Contents |
|---|---|
| `hooks/register.tsx` | the mod: subagent tracking, the rows under the hint, the toasts, the `/spotter` command and demo |
| `hooks/format.ts` | the rows as colored segments: model names, effort, token counts, window sizes, elapsed time, finish marks |
| `hooks/styles.ts` | the bar styles, the Motion levels and the settings |
| `hooks/motion.ts` | the bars' motion: what changed, the effects, each frame |
| `hooks/row.ts` | the row's dot and tail: the state glyph, the elapsed time, the tool flash and the finish mark |
| `hooks/cells.ts` | colors, blending, the cell encoding |
| `hooks/demo.ts` | the demo's script |
| `types/index.d.ts` | the mod's state contract |
| `tests/` | tests for the rows, the motion, the demo, the toasts, the settings and the figures |

## License

MIT, see [LICENSE](LICENSE).
