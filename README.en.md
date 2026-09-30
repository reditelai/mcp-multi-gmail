# mcp-multi-gmail

An MCP server that gives an assistant access to several Gmail mailboxes at
once and lets it search across all of them.

*[Česká verze: `README.md`](README.md) - the project is Czech-first, so the
Czech README is the one kept in step with the code.*

Claude's built-in Gmail connector handles one mailbox. Anyone with a work, a
company, a billing and a personal address has to watch each of them separately -
and most of them only so that nothing slips through. **Reaching several separate
mailboxes at once is the reason this server exists.**

**Mailboxes can be worked separately or together.** Most tools take one mailbox;
`mg_search_threads` also accepts `account: "all"` and sweeps them all. Which of
the two makes sense depends on how the mailboxes relate: where projects never
meet, searching across them is for the exception, and where they overlap, it is
the main thing. **The server does not decide that** - whoever drives it does.

**The server is built for [Miládka](https://miladka.cz)**, an AI assistant
that runs in Claude Code over your notes vault, but it works with any MCP
client. The guide for the assistant - how to set the server up with you and
how to work through the mail afterwards - is in
[`docs/pro-asistenta.md`](docs/pro-asistenta.md), in Czech. The server points
the assistant to it when it connects.

## Quick start

This connects **one mailbox** to Claude Code or Claude Desktop. No programming
is needed, but you will type a few commands into a terminal (PowerShell on
Windows, Terminal on macOS). More mailboxes go into the same file later, see
[Configure](#configure).

### 1. An app password in your Google account

The server does not log in to Gmail with your normal password but with an
**app password**: sixteen letters Google generates for this one purpose, which
can be revoked at any time.

1. Turn on **2-Step Verification** in your Google account (Security → 2-Step
   Verification). Without it Google will not issue an app password.
2. Open <https://myaccount.google.com/apppasswords>, type any name (say
   "mcp-multi-gmail") and let Google generate the password.
3. Copy it straight away; Google shows it only once.

Google displays it in four groups of four letters. **The spaces between the
groups do no harm**, so the password can be copied as Google shows it. When the
password is exactly 16 lowercase letters once whitespace is removed, the server
drops the whitespace itself. Any other password is used exactly as it is in the
file.

**A work account in Google Workspace** may have app passwords switched off by
its administrator. The app passwords page then says the setting is not
available for your account. You cannot fix that yourself - ask whoever manages
the domain to allow app passwords.

### 2. IMAP enabled in Gmail

In Gmail open Settings (the gear) → See all settings → **Forwarding and
POP/IMAP** → **Enable IMAP** → Save Changes. Some accounts have IMAP always on
and no such option; then there is nothing to change.

Leave the other options on that page at their defaults. The server needs to see
the All Mail, Drafts, Sent and Trash folders, and Gmail shows them over IMAP by
default.

### 3. What to install

- **Node.js 20 or newer.** Download the LTS version from <https://nodejs.org>.
  `node -v` tells you whether you already have it. Without administrator
  rights Node.js can be used without installing: the ZIP from
  <https://nodejs.org/dist/>, its SHA256 checked against `SHASUMS256.txt`;
  step 2 of the assistant guide has the details.
Nothing else: the server is released as **one file** with everything
inside, no `npm install` and no git.

### 4. Installation

From the [latest release](https://github.com/reditelai/mcp-multi-gmail/releases/latest)
download `mcp-multi-gmail.mjs` and `SHA256SUMS` into the folder the server
should live in (for example `~/mcp-multi-gmail/`; with Miládka
`<Miládka's folder>/.addons/mcp-multi-gmail/`) and check the checksum:

```sh
sha256sum -c SHA256SUMS        # on a Mac: shasum -a 256 -c SHA256SUMS
```

To build the server from source, see [Install](#install).

### 5. Configuration

**The file with the password belongs in no git repository.** Where to put it:

- **With Miládka**, the settings and the passwords are apart: the settings in
  `system/multigmail.json` are backed up with the vault, the passwords in
  `.miladka/secrets/multigmail/hesla.json` (`passwords.json` in the English
  Miládka) never are (see [step 7](#7-keeping-the-password-out-of-configjson-optional)).
  The whole `.miladka/secrets/` folder must be in the vault's `.gitignore` (the
  line `.miladka/secrets/`): Miládka commits the vault on her own, and a rule
  for a single file name would not catch a backup next to it. Miládka does the
  setup with you following [`docs/pro-asistenta.md`](docs/pro-asistenta.md),
  including a check that the folder is ignored.
- **Without Miládka**, outside any repository, for example
  `~/.config/multigmail/config.json`. Not in the server folder if you edit and
  push it yourself.

In the `mcp-multi-gmail` folder, copy the minimal example (without Miládka):

```sh
mkdir -p ~/.config/multigmail                                 # macOS, Linux
cp config.example.json ~/.config/multigmail/config.json
```

```powershell
mkdir $env:USERPROFILE\.config\multigmail                     # Windows, PowerShell
copy config.example.json $env:USERPROFILE\.config\multigmail\config.json
```

In `config.json`, replace the address and the password:

```json
{
  "accounts": [
    {
      "name": "prace",
      "address": "jan.novak@example.com",
      "password": "abcdefghijklmnop",
      "processed_label": "Asistent"
    }
  ]
}
```

- `name` is the short name the assistant calls the mailbox by. Lower-case
  letters without diacritics, digits, `-` and `_` only.
- `processed_label` is the label the assistant puts on messages it has read.
  Gmail gets it created the first time it is used. Call it whatever you like,
  for example `Assistant`.
- Sending is off in this example. It is turned on with `"can_send": true`, see
  [Configure](#configure).

On macOS and Linux narrow the permissions so nobody else can read the file
(folder 700, file 600):

```sh
chmod 700 ~/.config/multigmail
chmod 600 ~/.config/multigmail/config.json
```

Back the file up only into the same folder, never into the server folder or
anywhere else inside a repository.

On Windows a file in your user profile is readable only by you unless you have
changed its permissions. The server does not check the file's permissions itself.

**When an assistant does the setup, do not type the password into the chat** -
it would stay in the conversation transcript. The assistant writes the file with
a placeholder in place of the password and you paste the password into the file
yourself, in an editor. The procedure is in
[`docs/pro-asistenta.md`](docs/pro-asistenta.md).

You will need the **full path** to two files: `mcp-multi-gmail.mjs` in the server
folder and `config.json` wherever you put it. In the folder, `pwd` prints it
on macOS and Linux, `cd` on Windows.

### 6a. Connecting to Claude Code

```sh
claude mcp add --scope user multi-gmail -- node /path/to/mcp-multi-gmail/mcp-multi-gmail.mjs --config /path/to/config.json
```

On Windows write both paths with forward slashes, for example
`C:/Users/jan/.config/multigmail/config.json`.

Everything after `--` is the command Claude Code starts the server with.
`--scope user` makes the server available in all your projects, not only the
one you ran the command in. A running session does not load a newly added
server: quit Claude Code (`/exit`) and start it again. `/mcp` inside Claude
Code, or `claude mcp list`, then shows its state.

**Without the `claude` command** (typically Claude Code in the Claude desktop
app) the server can go into a `.mcp.json` file at the root of the project, for
Miládka the vault:

```json
{
  "mcpServers": {
    "multi-gmail": {
      "command": "node",
      "args": ["C:/Users/jan/mcp-multi-gmail/mcp-multi-gmail.mjs", "--config", "C:/Users/jan/.config/multigmail/config.json"]
    }
  }
}
```

Full paths, on Windows with forward slashes; with Node.js used without
installing, `command` is the full path to `node.exe`. The file holds no
passwords, only paths tied to this computer. In the next session Claude Code
asks whether to allow the project server - allow it. Details in step 9 of the
assistant guide.

### 6b. Connecting to Claude Desktop

Claude Desktop keeps its configuration in `claude_desktop_config.json`:

| System | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

The easiest way there is from the app: Settings → Developer → Edit Config. If
the file does not exist, create it. Add to the `mcpServers` block:

```json
{
  "mcpServers": {
    "multi-gmail": {
      "command": "node",
      "args": [
        "C:\\Users\\jan\\mcp-multi-gmail\\dist\\index.js",
        "--config",
        "C:\\Users\\jan\\.config\\multigmail\\config.json"
      ]
    }
  }
}
```

**Mind the backslashes in Windows paths.** In JSON each one is written twice
(`C:\\Users\\...`), otherwise the file is not valid. Forward slashes work
instead (`C:/Users/jan/mcp-multi-gmail/mcp-multi-gmail.mjs`); Node.js understands
them too. On macOS a path looks like `/Users/jan/mcp-multi-gmail/mcp-multi-gmail.mjs`.

If the file already lists other servers, add `"multi-gmail": { ... }` next to
them inside the existing `mcpServers`, with a comma between entries. Then
**quit Claude Desktop completely and start it again** - closing the window is
not enough.

### 7. Keeping the password out of `config.json` (optional)

Useful when you want `config.json` free of passwords, for a backup for
instance. There are two ways.

**A passwords file** (the way Miládka does it). In `config.json` the key
`passwords_file` and no `password` on the mailboxes:

```json
{ "passwords_file": "passwords.json", "accounts": [ { "name": "prace", "address": "jan.novak@example.com" } ] }
```

The passwords file holds each mailbox's short name and its app password:

```json
{ "prace": "abcdefghijklmnop" }
```

A relative path is resolved against the folder `config.json` is in; when the
server runs from Miládka's add-on folder (`.doplnky/` or `.addons/`), against
the root of the vault. The passwords file stays out of any repository, as the
whole `config.json` otherwise would (with Miládka in
`.miladka/secrets/multigmail/`), and `config.json` may then go into a backup.

**An environment variable.** Instead of `"password"` a mailbox can say
`"password_env"` with the name of an environment variable, and the client
passes the password in.

In `config.json`:

```json
{ "name": "prace", "address": "jan.novak@example.com", "password_env": "MG_HESLO_PRACE" }
```

In Claude Desktop, add an `env` block to the server:

```json
"multi-gmail": {
  "command": "node",
  "args": ["...", "--config", "..."],
  "env": { "MG_HESLO_PRACE": "abcdefghijklmnop" }
}
```

In Claude Code, add `--env` before the server name:

```sh
claude mcp add --scope user --env MG_HESLO_PRACE=abcdefghijklmnop multi-gmail -- node /path/to/mcp-multi-gmail/mcp-multi-gmail.mjs --config /path/to/config.json
```

The password does not disappear, it only moves into the client's
configuration. A mailbox cannot have both `password` and `password_env`. The
server takes the password from `password`, then `password_env`, then the
passwords file.

### 8. Checking it works

Tell the assistant:

> Call mg_list_accounts with verify: true.

The server logs in to every mailbox. When all is well the answer contains
`"verified": true` and an empty `"failures": []`. A mailbox that could not log
in is listed in `failures` together with what Gmail said - see
[When it does not work](#when-it-does-not-work).

On the first run the assistant will probably say that no classification labels
are set up and offer to go through them with you. That is expected: the minimal
example has none on purpose. A ready set and the other options are in
[`config.example.advanced.json`](config.example.advanced.json).

## When it does not work

The server's startup messages go to stderr, and are in Czech. In Claude Code,
`claude mcp list` and `/mcp` only show that the server did not connect. To see
the message itself, start the server by hand - it reads the configuration,
announces itself or prints the error, and exits:

```sh
node /path/to/mcp-multi-gmail/mcp-multi-gmail.mjs --config /path/to/config.json < /dev/null
```

With a valid configuration it prints `mcp-multi-gmail … běží, nastavených
schránek: …`. In Claude Desktop the messages are in the server log: `~/Library/Logs/Claude/mcp-server-multi-gmail.log` on macOS,
`%APPDATA%\Claude\logs\mcp-server-multi-gmail.log` on Windows. Gmail login
failures are reported by the tools, most easily by `mg_list_accounts` with
`verify: true`.

**After every change to `config.json`, the passwords file or a signature
file** have the assistant call `mg_reload_config`: the server loads them at
once, without a restart. Otherwise restart the server (in Claude Code `/mcp`
and Reconnect; quit and restart Claude Desktop completely). If the change still
does not show, an old server process with the old settings may be left
running: find it (`ps -eo pid,lstart,args | grep "[m]cp-multi-gmail.mjs"`
on macOS and Linux, Task Manager → Details → `node.exe` on Windows), end the
older one and reconnect.

### The server does not start

| Message | What to do |
|---|---|
| `Konfigurační soubor … nejde přečíst.` (the file cannot be read) | The path after `--config` does not lead to the file. Use a full path, not a relative one - the client starts the server from another folder. |
| `… není platný JSON: …` (not valid JSON) | A typo in the file: a missing or extra comma, straight quotes `"` replaced by curly ones, a single backslash in a Windows path. |
| `… není platná konfigurace:` followed by lines like `accounts.0.…` (not a valid configuration) | An unknown or misspelt key, or a value of the wrong shape. The line says exactly where. Unknown keys are refused on purpose: a typo would otherwise silently switch a safeguard off. |
| `prace nemá ani "password", ani "password_env", ani heslo v "passwords_file"` | The mailbox has no password. |
| `soubor s hesly … nejde přečíst` (the passwords file cannot be read) | The file named in `passwords_file` does not exist or the path leads elsewhere. A relative path is resolved against the folder of `config.json`, in Miládka's add-on folder against the root of the vault. |
| `soubor s hesly … není platný JSON` (not valid JSON) | A typo in the passwords file. Its content is not printed, because of the passwords. |
| `prace nemá heslo v souboru s hesly …` (no password in the file) | The passwords file has no line with the mailbox's short name, or it is spelt differently from `name`. |
| `POZOR: prace: heslo ještě není vložené …` (not pasted in yet) | The placeholder `SEM_VLOZ_HESLO_APLIKACE` is still in the file. The server keeps running, that mailbox does not log in. |
| `prace čeká heslo v proměnné MG_HESLO_PRACE, která není nastavená` | The variable named in `password_env` did not reach the server. Check the `env` block in the client's configuration, see [step 7](#7-keeping-the-password-out-of-configjson-optional). |
| `prace má zároveň "password" i "password_env"; nech jen jedno z nich` | Delete one of them. |
| `schránka prace: podpis "plny": soubor … nejde přečíst` | The signature file does not exist. A relative path is resolved against the folder `config.json` is in, not the one the server is started from. It is usually followed by `… odkazuje na podpis "plny", který v "signatures" není` - a consequence of the same mistake, not a second one. |
| the server dies right after start with a syntax or unknown module error | Node.js is too old. Install version 20 or newer (`node -v`). |

### The git warning

```
POZOR: … leží v gitovém repozitáři a není ignorovaný, a jsou v něm hesla aplikací. …
```

The server keeps running, but a file with passwords (the one in
`passwords_file`, or `config.json` when its mailboxes have `password`) sits
inside a git repository that does not ignore it. Typically that is a vault
without the line `.miladka/secrets/` in its `.gitignore`, or the file placed in
another repository. Settings without passwords are not checked: they may go
into a backup. Move it out of the repository (with Miládka into
`.miladka/secrets/multigmail/`), or add its whole folder to `.gitignore`. Take
it seriously: a password committed once stays in the history. **If it has
happened, deleting the file is not enough** - revoke the app passwords in the
Google account and create new ones, and only then clean the history.

### Logging in to Gmail failed

`mg_list_accounts` with `verify: true` returns `"code": "auth_failed"` for the
mailbox and Gmail's own answer in `message`. The server passes it on
unchanged, so the exact text depends on Google. The common cases:

| Cause | What to do |
|---|---|
| Wrong app password, or the normal account password in the configuration (Gmail typically answers `Invalid credentials` or `Application-specific password required`) | Generate a new app password and write it in again (spaces between the groups do no harm). Check the address too - a password belongs to one account. |
| The app password is gone | Google revokes app passwords when the account password changes. Generate a new one. |
| The app passwords page says the setting is not available | 2-Step Verification is off, or a Google Workspace administrator has disabled app passwords. See [step 1](#1-an-app-password-in-your-google-account). |
| IMAP is off (Gmail usually says so in its answer) | Turn it on, see [step 2](#2-imap-enabled-in-gmail). In Workspace an administrator can block it too. |

### A tool reports a missing folder

```
This mailbox does not report a all-mail folder, which Gmail and Google Workspace always do. Check that IMAP is enabled and that the folder is shown in IMAP.
```

In Gmail, Settings → **Labels**, check that All Mail, Drafts, Sent and Trash
have **Show in IMAP** ticked. Instead of `all-mail` the message may say
`drafts`, `sent` or `trash`.

## Status

**The server runs in real use on several mailboxes at once** - a personal one,
a shared team mailbox and one that receives only automated notifications.
Reading, passes over new mail, labelling, drafts and sending have all been
exercised against real Gmail.

From version 1.0.0 the tools and configuration keys stay backward compatible;
an incompatible change raises the major version. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

| Tool | Purpose |
| --- | --- |
| `mg_list_accounts` | the configured mailboxes and their settings |
| `mg_next_pass` | **a pass over new mail** - the threads holding an unprocessed message |
| `mg_search_threads` | search one mailbox or **all of them at once** |
| `mg_get_thread` | every message of a thread |
| `mg_get_message` | one message with a window of its body |
| `mg_get_attachment` | download one attachment to disk |
| `mg_list_labels` | the labels of a mailbox |
| `mg_label_message` / `mg_unlabel_message` | label messages, in one call |
| `mg_label_thread` / `mg_unlabel_thread` | label a whole thread |
| `mg_set_flags` | mark one message read, starred or answered |
| `mg_save_draft` | save a draft, optionally as a reply in a thread |
| `mg_list_drafts` | the drafts waiting in a mailbox |
| `mg_send_message` | send a message and file a copy in Sent |
| `mg_trash_message` | move one message to Trash |
| `mg_reload_config` | load the settings, app passwords and signatures again without a new conversation |

**Mail watcher:** `--wait --since name=boundary` runs the server as a watcher
in the background. Every 5 minutes it asks Gmail exactly what a pass asks and
ends when new mail arrives, which wakes the assistant. While nothing comes it
costs no tokens, unlike a pass run on a timer. Details in the assistant's
guide, section "Hlídač pošty".

Tool names carry the `mg_` prefix on purpose: the server is meant to run
alongside the built-in Gmail connector, which has tools of the same names.

## Scope

**Gmail and Google Workspace only, over IMAP.** The server stands on three
Gmail IMAP extensions:

| Extension | Used for |
| --- | --- |
| `X-GM-THRID` | thread ids - one `FETCH`, no reconstruction from headers |
| `X-GM-RAW` | the full Gmail search syntax (`after:`, `from:`, `label:`, …) |
| `X-GM-LABELS` | labels, read and write |

No other provider offers any of them, and plain `THREAD` (RFC 5256) is not
offered by Gmail, so there is deliberately no host setting: the server always
connects to `imap.gmail.com`.

## Requirements

- Node.js 20 or newer (the libraries used require it). Without administrator
  rights as the ZIP from <https://nodejs.org/dist/> with its SHA256 checked,
  see step 2 of the assistant guide.
- A Gmail **app password** for each mailbox (16 characters; requires two-step
  verification on the account)
- IMAP enabled in the Gmail settings of each mailbox

## Install

The ready server comes with every release as one file,
`mcp-multi-gmail.mjs` (with `SHA256SUMS`), see Quick start. From source:

```sh
git clone https://github.com/reditelai/mcp-multi-gmail.git
cd mcp-multi-gmail
npm install
npm run build          # dist/index.js
npm run bundle         # dist/mcp-multi-gmail.mjs, one file
```

## Configure

There are two examples:

- [`config.example.json`](config.example.json) - **the minimum for one
  mailbox**, used by the [Quick start](#quick-start).
- [`config.example.advanced.json`](config.example.advanced.json) - three
  mailboxes (a personal one, a shared team one and one for machines),
  classification labels, allowed recipients, signatures and an alias. It takes
  its passwords from environment variables through `password_env`, so it does
  not load without them: either set them in the client (see
  [step 7](#7-keeping-the-password-out-of-configjson-optional)) or change
  `password_env` to `password`.

Copy the one that fits to a place outside any repository (with Miládka the
settings into `system/` and the passwords apart, see [step 5](#5-configuration))
and fill it in:

```sh
cp config.example.json ~/.config/multigmail/config.json
```

Per mailbox:

| Key | Meaning |
| --- | --- |
| `name` | short name the mailbox is called by in every tool; must be unique |
| `address` | e-mail address of the mailbox |
| `password` | the app password itself, in the settings |
| `password_env` | name of an environment variable holding it instead |
| `shared` | true for a team mailbox read by several people |
| `work_scope` | how much of this mailbox is work in a pass: `everything`, or `inbox` on a team mailbox; defaults to `everything`; see [Pass modes](#pass-modes) |
| `assignment_labels` | the labels this mailbox uses to say who is handling a thread; see [Pass modes](#pass-modes) |
| `my_label` | the one of them that means the user |
| `unread_only` | whether a pass skips messages somebody already opened; defaults to `false`, see [Pass modes](#pass-modes) |
| `can_send` | whether the server may send from this mailbox; defaults to `false` |
| `watch` | whether the mail watcher (`--wait`) watches it; defaults to `false` |
| `allowed_recipients` | addresses or `@domains` this mailbox may send to; see below |
| `processed_label` | the whole name of the label marking a message as seen, e.g. `Assistant`; defaults to `processed`. **`null` means the mailbox is never labelled** - see [Pass modes](#pass-modes) |
| `classification_labels` | labels this mailbox may put on a thread, as name to meaning; overrides the set given once at the top of the file |
| `signatures` | this mailbox's signatures, as a name and where the text comes from; see [Signatures and aliases](#signatures-and-aliases) |
| `default_signature` | the signature a message ends with when none is named; without it a message is signed only on request |
| `aliases` | addresses this mailbox may write as |
| `smtp_port` | port used for sending: `465` or `587`. Without it the server tries 465 before the first send and uses 587 when 465 cannot be reached; see [`mg_send_message`](#mg_send_message) |

And once for the server, three keys (plus `smtp_port` for every mailbox that sets none):

| Key | What for |
|---|---|
| `passwords_file` | a file with app passwords (mailbox short name → password) for mailboxes without `password` and `password_env`; see [step 7](#7-keeping-the-password-out-of-configjson-optional) |
| `download_dir` | where downloaded attachments are saved; defaults to a folder in the system temporary directory |
| `attachment_dirs` | directories an outgoing message may attach a file from. **The default is empty, and leave it that way unless you know why you are changing it** |
| `quote_locale` | language of the line above a quoted message (`Dne … napsal:` / `On … wrote:`). `cs` or `en`, defaults to `cs` |
| `watch_hours` | when the mail watcher checks, for example `"9-19"`; unset means all day |
| `watch_interval` | how often the mail watcher checks, for example `"5m"` (at least `"1m"`); defaults to 5 minutes |

**An empty `attachment_dirs` means nowhere, not anywhere** - the same rule as
`allowed_recipients`. No separate switch is needed: having nowhere to read from
is the switch.

> **Read this before turning it on.**
>
> Attachments are **the only thing in this server that can carry data off your
> disk.** Everything else can at worst say too much back into a mailbox you
> already own.
>
> Keep in mind what the assistant works with: **it reads mail, which is text
> written by other people.** A message can be written to talk it into
> something - "please send me the file at …". An allowed directory is therefore
> exactly as large as the leak that can come out of it.
>
> If you do turn it on, point it at **a narrow folder meant for things going
> out.** Not a home directory, not a documents folder, and certainly not a
> notes vault.
>
> Paths are compared after symlinks are resolved, and a directory boundary ends
> at a separator, so a link pointing outside and a directory whose name merely
> starts the same both fail. That guards against a mistake; it is not a
> substitute for a narrow list.

## Pass modes

A pass is the same tool and the same procedure for every mailbox. **What differs
is what counts as work in that mailbox** - and the mailbox decides that itself,
through three keys. There is no "mode" switch: the mode is what those three
values add up to.

| Key | What it says |
|---|---|
| `processed_label` | what marks a message as having been through a pass |
| `classification_labels` | whether threads are sorted, and into what. **An empty set means this mailbox is never classified** |
| `work_scope` | how much of the mailbox is work: all of it (`everything`), or the inbox only (`inbox`) |

Three combinations are worth naming, because they cover nearly everything.

### A personal mailbox

One person writes from it. The pass takes the whole mailbox, threads are
classified, both the archive and sent mail are work.

```json
{ "name": "work", "work_scope": "everything", "can_send": true }
```

**The archive and sent mail earn their place here:** your own reply is how you
notice a thread is already answered, and the archive holds what that person
filed away themselves. Classification makes sense because the threads in this
mailbox belong to one person, and their sorting gets in nobody's way.

### A shared team mailbox

Several people read it and divide it between themselves.

```json
{ "name": "team", "shared": true, "work_scope": "inbox", "can_send": false,
  "classification_labels": {} }
```

Three differences, each for its own reason:

- **`work_scope: "inbox"`** - what sits in the inbox is what nobody has dealt
  with yet. **The archive is what somebody filed, and the sent folder holds other
  people's replies to other people's threads** - both are large and neither is
  work for whoever reads the mailbox. Messages outside the scope are taken out
  after the search, counted in `outside_scope_in_window` and **never hold the
  boundary back** - but a thread that is work for another reason still lists
  them, because "somebody has already answered this" is the most valuable thing
  obtainable without opening a thread.

  **The search still runs over the whole mailbox, not the INBOX folder.** A
  thread keeps its messages wherever they belong, so searching one folder would
  make the thread's own length and labels describe a fragment.
- **Empty `classification_labels`** - a classification is a claim about what
  somebody has to do. In a mailbox belonging to other people that is a claim
  about their work, and they will see it. An empty set turns that into a limit
  the server refuses to cross, rather than a rule that can be overlooked. The
  processed label still goes on, otherwise the mail is read over and over.
- **`can_send: false`** - answering as the team from its address is a different
  thing from answering as yourself.

**How anything is recognised as yours in such a mailbox.** A team usually marks
threads with whoever is handling them. Name those labels and the pass answers
the question for every thread:

```json
"assignment_labels": ["Ann", "Ben", "Cara", "Dan"],
"my_label": "Ann"
```

| `assigned` | When | What to do |
|---|---|---|
| `mine` | the thread carries `my_label` | it is the user's work, read it |
| `other` | it carries one of the others | label it and leave it, **do not open** |
| `none` | it carries none of them | nobody has taken it |
| `null` | the mailbox named no such labels | the question is not asked here |

**A thread belonging to somebody else can be labelled and left without ever
being opened** - and on a shared mailbox that is the expensive part.

Naming them is deliberate: a mailbox carries labels of several kinds at once,
and **a thread marked `Archive` is not somebody else's work but an unclaimed
thread somebody filed.** Weighing every user label would turn "carries a label I
do not recognise" into "not mine", and threads lost that way are lost silently.
A label outside the list therefore leaves a thread `none`.

Without those two keys only `user_labels` remains - a bare list of labels, whose
meaning is for whoever runs the server to decide.

### A mailbox for machines

An address that receives notifications from systems: billing, monitoring,
portals.

```json
{ "name": "machines", "work_scope": "inbox", "unread_only": true,
  "can_send": false, "classification_labels": {} }
```

It behaves like the shared one for a different reason: **nobody writes there, so
there is nothing to sort.** Almost all of it is processed by something else - an
accounting system, a script, a colleague - and the only part worth attention is
what nobody got to.

**A mailbox somebody clears by reading it need not be labelled at all.** Set
`processed_label` to `null` and the pass asks only about the time boundary:

```json
{ "name": "machines", "work_scope": "inbox", "unread_only": true,
  "processed_label": null, "can_send": false, "classification_labels": {} }
```

One consequence comes with it: **the boundary cannot move.** A message stays in
the window until somebody reads it, so `window_clear` stays `false` and the pass
keeps returning it. **Such a mailbox belongs in a pass that runs once a day, not
every half hour.** In exchange, no label appears in a mailbox where it would mean
nothing to anyone.

**`unread_only` is the right tool for that, and weaker than `work_scope`.**
Archived and sent are states somebody chose; read is a state a preview pane can
cause. **A message opened on a phone drops out of the pass and never comes
back** - it is out of scope, so it never gets labelled. Worth it only where the
alternative is reading everything.

The server never sets that flag itself: every read path opens its folder
read-only, so looking into a mailbox does not change what it says.

### What a mode never changes

Whatever the mailbox, a pass still asks **exactly two things: the message does
not carry the processed label, and it arrived after the boundary given.** None
of the above is added to that query - all of it is subtracted after the search.
The reason is in [`mg_next_pass`](#mg_next_pass): Gmail weighs conditions per
message, so one more condition drops a whole thread and the answer comes back
looking like a clean empty result.

It also holds in every mode that **the boundary moves only on
`window_clear: true`** and that **every message looked at gets the processed
label**, including one dealt with by a glance at the sender.

## Signatures and aliases

A mailbox rarely writes in a single voice. The same address sends quotes,
invoices and personal replies, and each of them ends differently. **That is why
a signature belongs to an alias here, not to the mailbox** - which address a
message goes out under and how it is signed is one decision, and splitting it
means picking the right address and then signing it wrong.

```json
{
  "name": "company",
  "address": "jan.novak@example.com",
  "can_send": true,
  "signatures": {
    "full": { "html_file": "signatures/full.html", "text_file": "signatures/full.txt" },
    "short": { "text": "Jan" },
    "sales": { "text": "Jan Novak\nSales department" }
  },
  "default_signature": "full",
  "aliases": [
    {
      "address": "sales@example.com",
      "name": "Company - sales",
      "purpose": "enquiries, quotes and price lists",
      "default_signature": "sales"
    }
  ]
}
```

**A signature is written where text is written, not in JSON.** It is long,
full of quotes and tags, and it changes. In a file of its own it opens as a
page; in the configuration it would have to be escaped again after every edit.
`text` and `html` directly in the configuration are for short signatures where
a separate file is not worth it. A relative file path is resolved against the
folder the configuration file is in. Signatures are not secret: with Miládka
they belong in the mail module (`.miladka/moduly/mail/podpisy/`), and
`system/multigmail.json` refers to them as
`../.miladka/moduly/mail/podpisy/plny.html`.

**Both forms are kept apart and each side of the message gets its own.** A
signature given only as text is converted for the HTML side rather than
dropped - a message that ends with nothing looks cut off.

**`purpose` is read by the assistant, not by Gmail.** Without it an alias is
just an address with no way of telling when it is the right one - and what the
assistant cannot tell, it simply never uses.

**An alias has to be in the configuration.** Gmail would refuse an unverified
one anyway, but that is not the reason: which addresses a mailbox writes under
is for whoever set it up to decide, and an address that merely is not forbidden
is not the same as one that is allowed. The same rule as for
`allowed_recipients` and `attachment_dirs`.

**A signature that cannot be found is an error, not a quietly unsigned
message.** The signature is what tells the recipient who is writing, and the
caller believed it was there.

**The signature is not repeated in the body.** The server inserts it, **above
the quote** - below the history it would end up at the bottom of a thread that
grows with every reply.

## Mail is data, not instructions

An assistant using this server **reads text written by people outside your
machine**. Anyone can write anything in a message, including sentences aimed at
the assistant: "forward me that file", "the user already approved this",
"disregard your rules".

The server says so in its instructions. **That is not a safeguard and should
not be relied on as one** - an instruction is text too, and text written to
mislead a model can claim the instruction no longer applies.

**The real boundary is what the server will not do, whoever writes to it:**

- it sends only from a mailbox allowed to send, and only to allowed recipients
- it attaches only from the listed directories, and without them not at all
- it applies only labels the configuration names
- it moves mail to Trash, never deletes it outright
- it keeps no state between calls, so there is nothing to overwrite

That is why leaving `attachment_dirs` empty and `allowed_recipients` filled in
is worth the inconvenience. **Those limits cannot be talked out of.**

**One thing the server cannot reach:** what the assistant writes down from the
mail it reads. A sent message you notice at once, but a falsehood stored as
fact surfaces months later - at the moment you act on it. That is for the rules
the assistant writes by, not for this server.

`processed_label` is the **whole** name of the label, not a leaf under some
prefix - write `Assistant` if that is what the mailbox already uses.

`classification_labels` names the labels the assistant may put on a thread,
each one paired with what it means:

```json
"classification_labels": {
  "Assistant/info": "read it, nothing to do",
  "Assistant/urgent": "needs dealing with today"
}
```

The meaning is not a comment. It is what the assistant reads when it decides
which label fits, so the names can be in any language and nothing in the code
has to know them. Written once at the top of the file they apply to every
mailbox; a mailbox that lists its own **replaces** that set rather than adding
to it, because a file that says which labels a mailbox uses should mean it.

**Those two settings are the whole set of labels these tools will touch.**
A label that is not in them is refused in either direction: an undeclared label
is never created, and a label the user put on a thread themselves is never
taken off. The first leaves clutter to find and delete, the second quietly
removes something the user meant to keep - and a label that is suddenly gone
shows up nowhere at all. `mg_list_labels` still shows everything the mailbox
has; it just cannot be changed from here.

Note that nesting written with `/` is Gmail's **display** nesting, not
inheritance: `Assistant/urgent` and `Assistant` are two independent labels, and a message
carrying the first does not carry the second. That suits the split this server
is built on - the seen label goes on the message, the classification on the
thread - but it does mean both have to be applied.

Each mailbox has exactly one password: `password`, `password_env`, or a line in
the file named in `passwords_file`. Setting both `password` and `password_env`
is rejected, because it would leave it unclear which one is in use and a
forgotten value in the other is a password nobody remembers is there.

`can_send` defaults to `false` for every mailbox. A configuration that granted
sending by omission would look locked without being locked.

`allowed_recipients` is optional and, when it is there, enforced exactly. **A
list that is present but empty allows nobody** - that is the point of writing
one. Omitting the key means no recipient limit, leaving `can_send` as the only
gate. An entry is either a full address or a domain written `@example.com`,
and a domain rule matches that domain only: `@partner.example` allows
`a@partner.example` but neither `a@evil-partner.example` nor
`a@sub.partner.example`.

### Keeping the file out of the repository

`config.json` holds your addresses and, if you use `password`, your app
passwords. That is why a file with passwords belongs outside any repository:
with Miládka in `.miladka/secrets/multigmail/` (the whole `.miladka/secrets/`
in the vault's `.gitignore`), otherwise for example in `~/.config/multigmail/`.
Settings without passwords (with `passwords_file`) may go into a backup: with
Miládka they are in `system/multigmail.json`. The
`config.json*` rule in the server's `.gitignore` is only a safety net for the
case where the file or a backup of it ends up in the server folder. Keep
backups in the same folder as the original.

If a file with passwords does sit inside a repository, **check that it is
ignored** (`git check-ignore -v path/to/file` must print the rule). On
startup the server looks at where the files with passwords sit: if it is inside a git
repository and not ignored, it says so on stderr before answering anything. It
is a warning rather than a refusal, but do not ignore it - a secret that
reaches the history cannot be removed from it.

## Run

```sh
node mcp-multi-gmail.mjs --config /path/to/config.json
```

From source, after `npm run build`, likewise `node dist/index.js --config …`.

The config path can also come from `MG_CONFIG`; it defaults to `config.json`
in the working directory.

To register the server with an MCP client:

```json
{
  "mcpServers": {
    "multi-gmail": {
      "command": "node",
      "args": [
        "/path/to/mcp-multi-gmail/mcp-multi-gmail.mjs",
        "--config",
        "/path/to/config.json"
      ]
    }
  }
}
```

## What the server tells the assistant

At connection the server hands the client a short set of instructions, and a
client that shows them to the model puts them in front of it before any tool is
called. They carry the few things that are true of the whole server rather than
of one tool: which mailboxes are available and that they can also be searched
together, what the two kinds of label mean, and that the configured set is the
whole set.

**They are built from the configuration, not written out**, and that is the
useful part. The labels of each mailbox are listed with what they mean, so the
assistant never has to guess a name. And when no classification labels are
configured, the instructions say so and ask the assistant to go through them
with the user before the first pass - a sentence that appears only while it is
true. Instructions are sent on every connection, so a fixed version of that
request would be repeated at the start of every conversation for ever, which is
how an instruction gets ignored.

## How the tools fit together

A pass over the mail looks like this:

1. **`mg_next_pass` for each mailbox separately**, each with its own boundary -
   the date up to which that mailbox is provably dealt with, in full. With
   `account: "all"` the pass returns one `window_clear` and one `searched_at` for
   all of them, so one mailbox with an unprocessed message would hold the window
   open for the others. The server builds the query
   itself out of the label and the boundary; **there is nowhere to add a third
   condition**, which is why this is a tool of its own rather than a parameter
   on search.
2. **`mg_get_thread` on any thread whose `message_count` is larger than the
   unprocessed messages you were given.** You are seeing part of a conversation
   and the rest may change what it means.
3. **`mg_get_message`** for the bodies actually worth reading.
4. **`mg_label_message`** with the mailbox's `processed_label` on **every**
   message you looked at, the noise included - **one call with a list**, not one
   call each. And **`mg_label_thread`** with a classification of the conversation.
5. **Move your boundary to `searched_at`, but only while `window_clear` is true.**
   While it is false something in the window is still unlabelled, and the window
   will be walked again next time.

Why the boundary moves so carefully: moved after every run, a message whose
label failed to be written ends up **behind** it - in no later window, so no
later pass will ever find it. Unlabelled noise, on the other hand, holds the
boundary where it is, which is why everything you looked at has to be marked.

## Tools

### `mg_list_accounts`

Lists the configured mailboxes: short name, address, whether the mailbox is
shared, whether sending is allowed, the label that marks a message as seen, the
classification labels with what each of them means, signatures and aliases.

It also reports **`work_scope`** - how much of that mailbox a pass treats as
work; see [Pass modes](#pass-modes). **Worth reading before concluding from
missing mail that nothing is arriving**: not arriving and being out of scope
look the same from here.

With `verify: true` it also logs in to every mailbox to check its app
password. For mailboxes that may send it checks sending too (it logs in to
SMTP and sends nothing) and returns the working port in `smtp`. Mailboxes are
checked in parallel, and **a mailbox that fails is reported next to the
results rather than instead of them.** A failure with `check: "smtp"` means
reading works but sending would not.

### `mg_next_pass`

Returns the threads holding a message that has not been through a pass. **This
is the tool for working through new mail**; `mg_search_threads` is for finding a
particular thing.

**It has no query parameter, and that is the point.** The pass asks for exactly
two things - not carrying the processed label, and delivered since the boundary
you give - and there is nowhere to add a third, because no text passes through.
Gmail weighs conditions per message rather than per thread: a single extra
`from:` drops a thread whose unprocessed message happens to be from somebody
else, and the answer comes back as a clean empty result.

**The window goes by delivery time, not by the `Date` header.** It is an IMAP
`SINCE` rather than Gmail's `after:` - the two disagree on forwarded mail, and a
boundary that went by the header would never again show a message forwarded
today but written last month. `SINCE` compares whole days, so the boundary's own
day is walked again every pass; that costs nothing, because everything done
carries the label.

Only **threads with real work** come back. Each carries its unprocessed messages
with sender, recipients and copies kept apart - being only in copy usually means
the thing belongs to somebody else - and whether the message is in the inbox or
archived. `message_count` is the size of the whole thread: when it is larger
than the messages returned, you are seeing part of a conversation and should
read the rest with `mg_get_thread`. It is `null` when the mailbox would not
say - **the messages already in hand are deliberately not used as the count**,
because that would read as "this is the whole thread" and the rest would go
unread.

`classification` says which category the thread carries now, so you know what
you are changing from.

`pending_outgoing` lists that thread's **drafts and scheduled messages**, so no
second answer gets written to something already waiting on a timer.

**Drafts and scheduled messages do not count as work.** They are the user's own
writing, they sit in the mailbox without the label, and a scheduled message
keeps matching until it goes out. Labelling them would not help: editing a draft
replaces the message, so the label does not survive. They are therefore left out
of the question of whether the window is clear, and they never hold the boundary
back. They are taken out **after the search**, never as a third condition, which
could hide a thread. A thread whose only unprocessed message is a draft is not
returned at all.

**A scheduled message is recognised by a delivery time in the future** and by
being from you. Gmail puts no label on one at all, so without that it would read
as ordinary incoming mail from the future - reported as work and holding the
boundary until it went out.

`stale_threads` counts threads the search returned that turn out to carry the
label already - Gmail updates its index some time after a label is written.
**They are not returned**, because reading them again is work for nothing.

**Move the boundary to `searched_at`, and only while `window_clear` is true.**
While it is false, `oldest_unprocessed_at` is the delivery time of the oldest
message still waiting - and when that stops moving between passes, something in
the window cannot be labelled and the window will grow until somebody looks.

### `mg_search_threads`

Searches one mailbox, or every mailbox with `account: "all"`. The query is the
full Gmail search syntax and is passed to Gmail unchanged through `X-GM-RAW`,
so nothing is translated and no condition can be dropped on the way.

The whole mailbox is searched, not the inbox: on an account with filters most
of the traffic never touches `INBOX`, so looking only there does not show what
the mailbox is doing. Whether a message is archived is reported per message as
`in_inbox`, taken from the label rather than from the folder.

`matched_messages` counts the messages of a thread that matched the query, not
the size of the thread - a thread of nine messages with one match reports `1`.

`unprocessed_matches` counts how many of those still lack the processed label,
**read from the messages themselves rather than from the search index.** Gmail
updates that index some time after a label is written, so a query for
unlabelled mail goes on returning threads that were labelled a moment ago.
Decide whether a thread holds anything new by this number, never by the thread
being in the results: `matched_messages: 3, unprocessed_matches: 0` is a stale
hit, and skipping it costs nothing. The lag can only ever show a thread that is
already done - it cannot hide one that is not - so this errs on the safe side
by construction.

Each thread carries a **summary of its newest matching message, not the whole
message**: sender, delivery time, state, `in_inbox` and `Message-ID`. That is
narrow on purpose - an answer covering forty threads that spells out the whole
message object for each of them stops fitting in the context and has to be read
from a file, at which point the tool cannot do what it exists for. **Nothing is
lost by it**, because searching is the first of two stages: `mg_get_thread`
returns the whole thread and `mg_get_message` the body, so only what is worth
reading gets fetched. For the same reason there is no verbosity switch - the
two-stage read works without one, and that is exactly why `format` never
appeared on the reading tools.

With `account: "all"`, **one mailbox failing does not lose the others.** The
mailboxes that answered are in `searched`, the ones that did not are named in
`failures` with a reason, and the results of the rest still stand. An empty
answer with failures listed means "these mailboxes could not be reached", not
"there is nothing there".

### `mg_get_thread`

Returns **every** message of one thread, oldest first. `message_count` is
always the number of messages returned; this tool never returns part of a
thread.

`unprocessed_messages` answers *"is there anything new here?"* without walking
the list, and each message repeats it as `processed`.

**`processed` is the assistant's own label, not the read flag.** The `seen`
field beside it is the IMAP `\Seen` flag, which a person sets by opening the
message in a mail client - and because this server opens mailboxes read-only,
an assistant reading a message never sets it. So `seen` says nothing about
what the assistant has done, and on a shared mailbox it says little about
anything: unread there does not mean unhandled, since a colleague may have
dealt with it without marking it.

Every message carries two identifiers and two timestamps, because the members
of each pair disagree and picking one would hide the disagreement:

| Field | Meaning |
| --- | --- |
| `message_id` | the `Message-ID` header - **stable** across folders and mailboxes, and the only reference worth storing |
| `uid` | the IMAP UID - valid only inside the folder it was read from, so archiving a message changes it |
| `received_at` | delivery time (`INTERNALDATE`); time filtering goes by this |
| `date_header` | the `Date:` header, which differs on forwarded and scheduled messages |

`state` is one of `received`, `sent`, `draft` and `scheduled`. The last one
matters: Gmail keeps a message waiting on a timer with its `Date:` header set
to the time it is due to go out, so without a state of its own it reads as a
message that has already been sent.

### `mg_get_message`

One message, with a window of its body. The body is windowed because on a long
thread every reply carries the quoted history, so the text runs into hundreds
of kilobytes; `body_total_length` is the whole length and `body_truncated` says
whether there is more. The plain text part is preferred and HTML is returned
as-is when there is no plain text, rather than converted - a conversion that
drops content silently is worse than markup you can see.

Bodies are decoded by the charset the message declares, so mail that still
arrives in `windows-1250` or `iso-8859-2` keeps its diacritics.

**Do not treat the quoted history in a reply as context.** It is usually there
but never guaranteed: mobile clients cut it off, attachments are never quoted,
and nothing in it says what is missing. The structure of a conversation comes
from `mg_get_thread`.

Attachments are listed with a size but not downloaded.

### `mg_get_attachment`

Downloads one attachment and writes it into `download_dir`, returning the path.
The content is not returned inline, because an attachment is routinely
megabytes. The filename from the message is treated as untrusted input: only
the last path segment is kept and separators and control characters are
replaced, the same way on every platform.

### The labelling tools

`mg_list_labels` lists what a mailbox has. `mg_label_message`,
`mg_unlabel_message`, `mg_label_thread` and `mg_unlabel_thread` change labels,
and a configured label that does not exist yet is created first - Gmail will not
apply a label it does not know, and reports no error when that happens.

**Every change is read back before it is reported.** A `STORE` the server
accepts but does not act on would otherwise leave you believing a message is
marked when it is not, and the whole mechanism rests on that mark being true.
The read-back is a `FETCH` of those messages, **never a search** - the search
index is updated some time after a label is written and would answer with what
was true a moment ago.

**Labelling messages takes a list and reports each message separately.** One
call instead of forty: every call opens its own connection, and logging in
costs about as much as the work itself. Each message comes back as `changed`,
`already`, `not_found` or `failed` - **a message that could not be labelled
neither fails the call nor hides inside an overall success.** The caller
decides from these results how far its time boundary may move, which a
per-batch summary could not support. Labelling a message that already carries
the label is not an error and comes back as `already`, so repeating an
interrupted pass is safe.

**A message label and a thread label are different operations, and that is
why there are separate tools:**

| Where | Which label |
| --- | --- |
| on a **message** | has this message been through a pass - it says something about that one message |
| on a **thread** | a classification of the conversation (action, waiting, info, urgent) |

**The split is enforced, not merely documented.** `mg_label_message` takes only
the `processed_label` and `mg_label_thread` only classifications; the other way
round is refused with the reason. The dangerous half is the pass label on a
thread - Gmail would put it on tomorrow's reply, and that message would **never
show up as new**.

**A thread carries one classification and they exclude each other, so
`mg_label_thread` sets it rather than adding:** the one you give goes on and
every other configured classification comes off in the same call. Do not remove
the old one first - two calls would leave a moment where the thread is in two
categories or in none, and a thread in no category reads as one nobody has
looked at. `classification_before` and `classification_after` say what it was
and what it is now.

Gmail's thread labelling also reaches messages that arrive in the thread
later. The pass label on a thread would therefore mark tomorrow's reply as
already looked at before anyone read it - which is exactly the kind of silent
loss the split prevents.

**The message label is a filter for the next pass, not a verdict.** It answers
one question - has this message been through a pass - and noise carries it
just as much as a message still waiting for an answer: both were looked at, and
neither needs reading again. What still has to happen is a classification, and
that goes on the thread.

This matters more than it sounds. A message left unlabelled comes back in
**every** pass from now on, and the mail most likely to be left unlabelled is
the mail nothing had to be done about. Read the label as "dealt with" and the
backlog fills up, quietly, with exactly what mattered least.

Gmail's own labels (`\Inbox`, `\Starred`, `\Trash` and the rest) are refused.
Writing those means archiving, starring or deleting a message, each with
consequences of its own, and none of them is what these tools are for.

### `mg_set_flags`

Sets the IMAP flags of one message: `seen`, `flagged` (the star in Gmail) and
`answered`. Each flag you pass is set to that value, the ones you leave out are
not touched, and at least one has to be passed. The flags are read back after
the change, like every other write here.

**This is not where the assistant records its own work.** The `\Seen` flag
belongs to whoever opened the message in a mail client - this server opens
mailboxes read-only, so reading a message through it never sets `\Seen` - and
on a shared mailbox unread does not mean unhandled. What has been through a
pass goes in a label, on the message.

**The list of writable flags is closed on purpose.** `\Deleted` is not in it:
marking it is not a flag change but a deletion, and what Gmail does with an
expunged message depends on a setting in the user's own account rather than on
this server. `\Draft` is not in it either, because clearing it would leave a
message that is neither a draft nor sent.

### `mg_save_draft`

Saves a draft into the Drafts folder with IMAP `APPEND`. Nothing is sent and no
SMTP connection is opened.

For a reply, pass `in_reply_to` with the `Message-ID` being answered.
**The thread the draft landed in is read back and compared with the thread it
was meant for**, and `joined_thread: false` means the draft did not attach and
would go out as a separate message. That is worth knowing before the message is
sent, not after.

`from_alias` sets the `From` header to another address. It has to be an alias
already verified in Gmail; this server cannot verify one, and that is a
one-off setting in Gmail rather than something a mail protocol can do.

**The draft is saved without the `\Draft` flag**, which reads oddly against
IMAP. Gmail does not set it on its own drafts either - one written in the web
interface arrives in the folder with `\Seen` alone, and being in Drafts is what
makes it a draft. **A message that does carry the flag looks foreign to Gmail,
which folds its whole body under the "show trimmed content" button** as if it
were quoted history. The draft then looks empty and the user has to click to
find their own text.

**Write the body as HTML in the shape Gmail itself produces** - an outer
`<div dir="ltr">`, each paragraph as a `<div>`, a blank line as
`<div><br></div>`. Using `<p>` causes the same folding as the `\Draft` flag
does, because Gmail does not treat those as its own text.

> **Watch out for plain text mode.** With it switched on in the compose window,
> Gmail discards the HTML part and works from the plain text - **which it then
> hard-wraps mid-sentence when the message is sent.** Nothing gives it away
> except the words "Plain text" in the window's title bar, and it looks like a
> fault in the server. It is not.

### `mg_list_drafts`

Lists the drafts waiting in a mailbox, newest first.

Each draft repeats the `joined_thread` check `mg_save_draft` makes, **run
against the mailbox as it is now** rather than trusted from when the draft was
stored. A draft can come loose from its thread afterwards - an edit in another
client is enough - and a loose draft looks entirely ordinary in a listing right
up to the moment it goes out as a message of its own.

`joined_thread: null` means the draft is not a reply, or that the message it
answered is no longer in the mailbox and there was nothing left to compare it
with. `warning` says which.

### `mg_send_message`

Sends a message over SMTP and files a copy in Sent. **This cannot be undone**,
so it is the most guarded tool here.

**The port is chosen beforehand, never after an error.** Hosting providers,
company networks and hotel wifi often block port 465. Without `smtp_port` the
server only tries logging in on 465 before the first send from a mailbox, and
on 587 when 465 cannot be reached - sending nothing. It remembers the port
that works. The send itself then goes through one port and **is never retried
through another after an error**: the connection can drop after Gmail has
already accepted the message, and a second attempt would deliver it twice. An
error where nothing was sent says so; an error in the middle of sending says
the message may have gone out and the Sent folder should be checked first.
The result reports the `smtp_port` it went through.

**Two locks, both closed by default.** A mailbox sends only if `can_send` says
so, and that defaults to false; if `allowed_recipients` is configured it is
enforced exactly, and an empty list allows nobody.

**Two outcomes, reported separately.** `accepted` and `rejected` say which
recipients the message reached; `sent_copy` says whether it can be found in
Sent. **A missing copy does not mean a failed send:** if `sent_copy.saved` is
false the message has gone out anyway and must not be sent again, it simply
will not appear in Sent and a later pass over the mailbox will not know about
it. Anything worth knowing is repeated in `warning`.

**Gmail files the copy itself.** SMTP knows nothing about mailboxes, so a mail
client normally sends over SMTP and then appends a copy to Sent over IMAP -
but Gmail is an exception: everything sent through `smtp.gmail.com` is saved to
Sent automatically, and there is no way to switch that off. Appending a second
copy would upload the message twice and can make Gmail's IMAP server reject the
append, which would then be reported as a missing copy that is in fact there.

So the copy is **verified rather than written**: after sending, Sent is
searched for the `Message-ID`, retried briefly since Gmail may not have filed
it the instant the send returns. Only if it is not there does the server append
it itself. `sent_copy.filed_by` says which happened - `gmail` or `server`. The
bytes appended are the bytes that were sent, because the message is composed
once and the same buffer goes to SMTP and to `APPEND`.

**Sending an existing draft is not possible over SMTP** and this server does
not pretend otherwise. The protocol has no such operation: sending what a draft
says means composing the same message again and clearing the original away
afterwards.

**That clearing away is the assistant's to do, and it comes after the send,
never before it.** The order is the only safe one. If the trashing fails, a
duplicate is left in Drafts - visible, removable, and nothing is lost. The
other way round, a send that fails leaves the message unwritten and the draft
already gone, so the text is gone with it and there is nothing to recover it
from. Clearing the draft is right here: the user asked for the message to go
out, not for a copy of it to stay behind. It is the one exception to the rule
under `mg_trash_message` that mail is not tidied up unasked.

**A draft still sitting in Drafts after the send is not a normal state.** It
means the trashing failed, and it is worth noticing - which is exactly why it
is done second.

### Forwarding

**There is no forward tool, and there will not be one.** Neither IMAP nor SMTP
has such an operation: passing a message on is, as far as the protocols are
concerned, **a new message** rather than an act upon the original one. Nothing
is missing here - it just goes by another name.

To pass a message on:

1. Reply into its thread with `mg_send_message` (or `mg_save_draft`), setting
   `in_reply_to` to the `Message-ID` of the original and giving **a different
   recipient**.
2. **Quote the original in the body yourself.** Nothing is added
   automatically - neither headers nor text.

3. **Take the attachments along yourself.** They do not follow: download them
   with `mg_get_attachment` and pass the saved files in `attachments`.

**If you leave the attachments out, say so** - rather than sending mail whose
recipient believes the invoice is in it.

**Attaching only works from the directories `attachment_dirs` names**, and with
none configured it does not work at all, which is the default. Gmail also
refuses a message over 25 MB, and encoding makes attachments about a third
larger than they are on disk, so a long thread with attachments may not fit
into one message.

### `mg_trash_message`

Moves one message to Trash. One message, never a whole thread: labelling has a
thread tool because a classification is about the conversation, and throwing
mail away is not.

**Nothing here deletes mail permanently.** Gmail keeps a trashed message for 30
days, and until then the user can restore it.

**This is still the user's mailbox**, so it is used when they asked for a
message to go, not to tidy up. That a message has been through a pass is
recorded with a label through `mg_label_message`, and the message stays where
it is. The one exception is a draft whose text has just gone out through
`mg_send_message` - that one the assistant clears away itself, as above.

**It moves the message rather than marking it `\Deleted`**, and the difference
is not cosmetic. What Gmail does with a message a client marks deleted and
expunges is decided by a setting in the user's own IMAP options - archive it,
trash it, or delete it forever - so the same call would do three different
things on three accounts, one of them irreversible. A `MOVE` to the folder the
server itself reports as `\Trash` does one thing everywhere. (Gmail advertises
the `MOVE` extension only after login, so a capability list read before
authenticating does not show it.)

The message is looked for in Trash after the move, so a move that did not
happen is an error rather than a cheerful report. Asking again for a message
already in Trash is not an error: the result says `moved: false` and nothing is
touched.

## Security

- **A Gmail app password opens the whole mailbox and cannot be narrowed.**
  Gmail's IMAP requires the full `https://mail.google.com/` scope, so there is
  no read-only variant. Any restriction has to happen in this server.
- Passwords are never written to a log and never returned by a tool.
- Mailboxes are opened **read-only** for reading, so looking at a message does
  not mark it as read in your mailbox.
- Diagnostics go to stderr only; stdout carries the MCP protocol.
- Sending is off for every mailbox until the configuration turns it on, and a
  configured but empty `allowed_recipients` list allows nobody rather than
  everybody.

## License

Apache License 2.0 - see [LICENSE](LICENSE) and [NOTICE](NOTICE).
