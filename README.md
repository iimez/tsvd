# tsvd

CLI to edit tabular data spreadsheets using LLMs.

## What is tsvd?

A (simplified) Claude-Code-like editing experience to interact with TSV data. Source data may be loaded from tsv or quickly pasted via clipboard (copied from a popular spreadsheet editing software). Iterate with an LLM on a temporary
working file until satisfied, then CTRL+C to save changes back to source or create a new file.

The harness has some reliability improvements when working on tabular data:
- Clearer column / row labelling to get cell references right, puts everything into a markdown table
- Provides tools for precise cell/area replacement, bulk edits, and string replacements
- Makes sure AI assumes the spreadsheet has to be compatible with the featureset of Google Sheets
- Nudges Claude not to break spreadsheets when working with data in non-US locales

While the harness does not limit spreadsheet size, LLMs easily make mistakes at larger sizes. For reasonable performance/cost I'd recommend to keep bounds under 100 rows and 26 columns (A-Z).

Note: There is currently no evaluation of cells and formulas going on, and no automatic validation or correction of model edits.

## Installation

### Prerequisites

- [Deno](https://deno.land/) runtime
- An API key from one of these providers:
  - [Anthropic API key](https://console.anthropic.com/) in the `ANTHROPIC_API_KEY` environment variable
  - [OpenRouter API key](https://openrouter.ai/settings/keys) in the `OPENROUTER_API_KEY` environment variable

### Setup

1. Clone the repository:

   ```bash
   git clone git@github.com:iimez/tsvd.git
   cd tsvd
   ```

2. Build a standalone binary (recommended):

   ```bash
   deno task compile
   ```

   This creates an optimized `tsvd` binary with faster startup and all permissions pre-configured.

3. (Optional) Move the binary to your PATH:

   ```bash
   sudo mv tsvd /usr/local/bin/
   ```

   Or run directly from the project directory with `./tsvd`

4. Set your API key:
   ```bash
   export ANTHROPIC_API_KEY=your-api-key-here
   ```

### Alternative: Run without compiling

You can also run directly with Deno:

```bash
deno run --allow-read --allow-write --allow-env --allow-net --allow-run tsvd.ts
```

## Usage

### Basic Usage

```bash
# Interactive mode
tsvd data.tsv

# Pass an initial prompt
tsvd data.tsv --prompt "Add a Total column"

# Will fall back to $EDITOR to ask for input
tsvd
```

This opens an interactive session where you can describe changes to make to your
TSV file.

### Command-Line Options

```bash
tsvd [OPTIONS] [file]

Options:
  -m, --model <model>        Model to use (defaults based on provider)
  -p, --provider <provider>  Provider: anthropic or openrouter (auto-detected)
  --prompt <prompt>          Initial prompt to send to the model
  --cache                    Enable prompt caching (default: false)
  -d, --debug                Enable debug mode with verbose logging
  -h, --help                 Show help message
  -V, --version              Show version

Arguments:
  [file]                     TSV file to edit (optional, will prompt if not provided)
  -                          Read from stdin
```

### Examples

```bash
# Edit a file with default provider (Anthropic if key is set)
tsvd sales.tsv

# Pass an initial prompt to execute immediately
tsvd sales.tsv --prompt 'add a total column'

# Enable prompt caching for better performance on large spreadsheets
tsvd sales.tsv --cache

# Read from stdin
cat sales.tsv | tsvd -

# Combine options
tsvd data.tsv --prompt 'add totals' --model claude-opus-4-1-20250805 --cache --debug
```

## Interactive Session

Once you start tsvd, you'll see a prompt where you can type commands in natural language:

```
tsvd ./testsheets/basic.tsv
→ Loaded ./testsheets/basic.tsv (10 rows, 7 columns) — working file: .tsvd-1761877864650.tsv
prompt › lets add gorm fluid for $2000
[thinking]
The user wants to add "gorm fluid" for $2000 to the spreadsheet. Looking at the current table, I can see it's a product pricing table [...]
tsvd › I'll add "gorm fluid" to the spreadsheet. I'll place it in row 7 (which is currently empty) with a quantity of 1 and price of $2000, using the same tax rate as the other products.
[replace_area(A7, G7, [["gorm fluid","1","2000.00","=B7*C7","0.08","=D7*E7","=D7+F7"]])]
╭─ Proposed changes ─────────────────────────────────────────
@@ -4,8 +4,8 @@
 Keyboard→      3→      79.99→  =B4*C4→ 0.08→   =D4*E4→ =D4+F4
 Monitor→       1→      299.99→ =B5*C5→ 0.08→   =D5*E5→ =D5+F5
 Headphones→    4→      149.99→ =B6*C6→ 0.08→   =D6*E6→ =D6+F6
-
+gorm fluid→    1→      2000.00→      =B7*C7→ 0.08→   =D7*E7→ =D7+F7
 Subtotal→      →       →       →       =SUM(D2:D6)
 Total Tax→     →       →       →       →       =SUM(F2:F6)
 Grand Total→   →       →       →       →       →       =SUM(G2:G6)
├────────────────────────────────────────────────────────────
? Accept changes? (Y/n) › Yes
→ Working file updated: .tsvd-1761877864650.tsv
prompt › the empty row between items and fomulas got removed, can you fix?
tsvd › [replace_area(A8, G11, [["","","","","","",""],["Subtotal","","","=SUM(D2:D7)","","",""],["Total Tax","","","","","=SUM(F2:F7)",""],["Grand ...)]
Fixed! I added the empty spacer row back between the items and the formulas. Now there's a blank row at row 8, followed by the Subtotal, Total Tax, and Grand Total formulas starting at row 9.
╭─ Proposed changes ─────────────────────────────────────────
@@ -5,7 +5,8 @@
 Monitor→       1→      299.99→ =B5*C5→ 0.08→   =D5*E5→ =D5+F5
 Headphones→    4→      149.99→ =B6*C6→ 0.08→   =D6*E6→ =D6+F6
 gorm fluid→    1→      2000→   =B7*C7→ 0.08→   =D7*E7→ =D7+F7
-Subtotal→      →       →       =SUM(D2:D7)→    =SUM(D2:D6)
-Total Tax→     →       →       →       →       =SUM(F2:F7)
+→      →       →       →       →       →
+Subtotal→      →       →       =SUM(D2:D7)→    →       →
+Total Tax→     →       →       →       →       =SUM(F2:F7)→
 Grand Total→   →       →       →       →       →       =SUM(G2:G7)
├────────────────────────────────────────────────────────────
? Accept changes? (Y/n) › Yes
→ Working file updated: .tsvd-1761877864650.tsv
prompt › ^C
You have unsaved changes to the original file.
? Save to ./testsheets/basic.tsv? (Y/n) › Yes
→ Saved to ./testsheets/basic.tsv
```

`tsvd` will:

1. Show the model's reasoning and tool use
2. Reload the working file from disk before every turn to allow for manual edits
3. Ask for confirmation of proposed changes in colored diffs

To exit, press Enter on an empty line or press Ctrl+C.

You will be prompted to save changes when you exit. The working file will be cleaned up automatically.

## Provider Support

tsvd supports multiple AI providers:

- **Anthropic**: Default when `ANTHROPIC_API_KEY` is set
  - Supports prompt caching with the `--cache` flag
  - Shows cache read/write metrics when caching is enabled

- **OpenRouter**: Use when `OPENROUTER_API_KEY` is set
  - Access to many models including OpenAI, Gemini, and others
  - Supports reasoning/thinking modes where available
  - Supports prompt caching with the `--cache` flag (where available)
  - Specify with `--provider openrouter`

The provider is auto-detected based on which API key is set. Use `--provider` to explicitly choose one when both keys are available.

### Prompt Caching

Use the `--cache` flag to enable prompt caching, which can significantly reduce costs and improve response times for large spreadsheets. Both Anthropic and OpenRouter support prompt caching. When enabled, you'll see cache metrics in the output showing cache reads/writes and their token counts.
