# tsvd

An AI-powered TSV (Tab-Separated Values) editor that lets you modify spreadsheets using natural language.

## What is tsvd?

tsvd is an interactive command-line tool that combines the power of Claude AI with spreadsheet editing. Instead of manually editing TSV files or writing complex scripts, you can simply describe what you want to do in plain English, and Claude will make the changes for you.

## Features

- 🤖 **Natural Language Editing**: Describe changes in plain English
- 📊 **Formula Support**: Full Excel-style formula support (SUM, AVERAGE, IF, VLOOKUP, etc.)
- 🔍 **Smart Diff Viewer**: See exactly what will change before applying
- 💬 **Interactive Conversation**: Iterate on changes through a conversational interface
- ✅ **Safe by Default**: Review and approve changes before they're saved
- 🔄 **Undo Support**: Revert to original state on exit if needed

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

### Examples

```bash
# Edit a file with the default model
tsvd sales.tsv

# Use a specific Claude model
tsvd --model claude-opus-4-20250514 data.tsv

# Enable debug mode
tsvd --debug data.tsv
```

## Interactive Session

Once you start tsvd, you'll see a prompt where you can type commands in natural language:

```
Loaded sales.tsv (150 rows, 5 columns)

user › Add a new column called "Total" that sums Price and Tax
```

Claude will:
1. Show its thinking process (if applicable)
2. Propose the changes
3. Display a colored diff showing what will change
4. Ask for your confirmation before saving

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

## Formula Syntax

tsvd supports Excel-style formulas with one important difference: **parameters are separated by semicolons (`;`) instead of commas (`,`)**:

```
✅ Correct:  =SUM(A1;A2;A3)
❌ Wrong:    =SUM(A1,A2,A3)

✅ Correct:  =IF(A1>100;"High";"Low")
❌ Wrong:    =IF(A1>100,"High","Low")
```

This semicolon syntax is used in some locales (like European Google Sheets) to avoid conflicts with comma decimal separators.

### Supported Functions

- Arithmetic: `SUM`, `AVERAGE`, `MIN`, `MAX`
- Logic: `IF`, `AND`, `OR`, `NOT`
- Lookup: `VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH`
- Text: `CONCATENATE`, `LEFT`, `RIGHT`, `MID`, `LEN`
- Cell references: `A1`, `B2`, ranges like `A1:A10`
- And more...

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

## Requirements

- **Deno**: The script runs on Deno (specified in shebang)
- **Permissions**: Requires `--allow-read`, `--allow-write`, `--allow-env`, and `--allow-net`
- **API Key**: Valid Anthropic API key in `ANTHROPIC_API_KEY` environment variable

## Troubleshooting

### "ANTHROPIC_API_KEY environment variable not set"

Set your API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### "Table has X columns, exceeds maximum of 26"

Your TSV has too many columns. Consider splitting it into multiple files or removing unnecessary columns manually first.

### "String appears N times. Please be more specific or use replace_all"

Claude tried to use `str_replace` but the text appears multiple times. Ask Claude to be more specific about which occurrence to change.

## License

[Add your license here]

## Contributing

[Add contribution guidelines here]