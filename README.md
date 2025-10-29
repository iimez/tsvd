# tsvd

An AI-powered TSV (Tab-Separated Values) editor that lets you modify spreadsheets using natural language.

## What is tsvd?

tsvd is an interactive command-line tool to provide a Claude-Code like editing experience for spreadsheets in tsv format.

The harness improves reliability of AI when working on tabular data:
- Clearer column / row labelling to get cell references right
- Makes sure AI assumes the spreadsheet has to be compatible with the featureset of Google Sheets
- Nudges Claude not to break spreadsheets when working with data in non-US locales

## Features

- 💬 **Interactive Conversation**: Iterate on changes by prompting through a conversational interface
- 🔍 **Diff Viewer**: See exactly what will change before applying
- ✅ **Safe by Default**: Review and approve changes before they're saved, CTRL+C any time

## Installation

### Prerequisites

- [Deno](https://deno.land/) runtime
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

1. Clone or download `tsvd.ts`

2. Make it executable:
   ```bash
   chmod +x tsvd.ts
   ```

3. (Optional) Create a symlink to use it from anywhere:
   ```bash
   ln -s /path/to/tsvd.ts /usr/local/bin/tsvd
   ```

4. Set your Anthropic API key:
   ```bash
   export ANTHROPIC_API_KEY=your-api-key-here
   ```

## Usage

### Basic Usage

```bash
tsvd data.tsv
```

This opens an interactive session where you can describe changes to make to your TSV file.

### Command-Line Options

```bash
tsvd [OPTIONS] <file.tsv>

Options:
  --model, -m <MODEL>    Specify Claude model (default: claude-sonnet-4-5-20250929)
  --debug, -d            Enable debug mode with verbose logging
  --help, -h             Show help message
```

## Requirements

- **Deno**: The script runs on Deno (specified in shebang)
- **Permissions**: Requires `--allow-read`, `--allow-write`, `--allow-env`, and `--allow-net`
- **API Key**: Valid Anthropic API key in `ANTHROPIC_API_KEY` environment variable

### Examples

```bash
# Edit a file with the default model
tsvd sales.tsv

# Use a specific Claude model
tsvd --model claude-opus-4-1-20250805 data.tsv

# Enable debug mode
tsvd --debug data.tsv
```

## Interactive Session

Once you start tsvd, you'll see a prompt where you can type commands in natural language:

```
Loaded sales.tsv (150 rows, 5 columns)

user › Add a new column called "Total" that sums Price and Tax
```

`tsvd` will:
1. Propose the changes and display a colored diff showing what will change
2. Ask for your confirmation before saving

To exit, press Enter on an empty line or press Ctrl+C.

### Example Interactions

**Adding calculated columns:**
```
user › Add a column that calculates 20% commission on the Sales column
```

**Filtering data:**
```
user › Remove all rows where Status is "cancelled"
```

**Sorting:**
```
user › Sort by Date in descending order
```

**Data transformation:**
```
user › Convert all email addresses to lowercase
```

**Using formulas:**
```
user › Add a column with =SUM(A2:A10) at the bottom
```

## Limits

- Maximum columns: 26 (A-Z)
- Maximum rows: 1,000

These limits ensure optimal performance and reasonable API token usage.

## How It Works

1. **Load**: tsvd reads your TSV file and converts it to an internal table format
2. **Convert**: The table is displayed to Claude as a markdown table with row numbers and column labels
3. **Edit**: Claude uses two tools to make changes:
   - `str_replace`: For precise, surgical edits (must match exactly once)
   - `replace_all`: For major restructuring, sorting, or bulk changes
4. **Review**: You see a diff of all proposed changes
5. **Apply**: If you approve, changes are saved to disk

You exit tsvd by pressing Enter on an empty line or pressing Ctrl+C.

## Debug Mode

Enable debug mode with `--debug` or `-d` to see:
- API request/response details
- State file dumps (saved as `<filename>.tsv.state`)
- Table dimension information
- Tool execution details

```bash
tsvd --debug data.tsv
```
