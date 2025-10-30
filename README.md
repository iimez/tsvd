# tsvd

CLI to edit spreadsheets in TSV format, using LLMs.

## What is tsvd?

A simple tool to interact with TSV data pasted from clipboard (copied from Excel or Google Sheets) or stored in files, using a natural language prompt / diff confirm loop.

The harness has some reliability improvements when working on tabular data:
- Clearer column / row labelling to get cell references right
- Makes sure AI assumes the spreadsheet has to be compatible with the featureset of Google Sheets
- Nudges Claude not to break spreadsheets when working with data in non-US locales

## Installation

### Prerequisites

- [Deno](https://deno.land/) runtime
- An API key from one of these providers:
  - [Anthropic API key](https://console.anthropic.com/) in the `ANTHROPIC_API_KEY` environment variable
  - [OpenRouter API key](https://openrouter.ai/settings/keys) in the `OPENROUTER_API_KEY` environment variable

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

4. Set your API key:
   ```bash
   export ANTHROPIC_API_KEY=your-api-key-here
   ```

## Usage

### Basic Usage

```bash
# Interactive mode
tsvd data.tsv

# Pass an initial prompt
tsvd data.tsv --prompt "Add a Total column"

# Read from stdin (paste TSV data)
cat data.tsv | tsvd -

# Will fall back to $EDITOR to ask for input
tsvd
```

This opens an interactive session where you can describe changes to make to your TSV file.

### Command-Line Options

```bash
tsvd [OPTIONS] [file]

Options:
  -m, --model <model>        Model to use (defaults based on provider)
  -p, --provider <provider>  Provider: anthropic or openrouter (auto-detected)
  --prompt <prompt>          Initial prompt to send to the model
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

# Use OpenRouter with a specific model
OPENROUTER_API_KEY=... tsvd --provider openrouter --model openai/gpt-4o data.tsv

# Pass an initial prompt to execute immediately
tsvd data.tsv --prompt "Sort by price descending"

# Read from stdin
cat data.tsv | tsvd -

# Combine options
tsvd data.tsv --prompt "Add a Total column" --model claude-opus-4-1-20250805 --debug
```

## Interactive Session

Once you start tsvd, you'll see a prompt where you can type commands in natural language:

```
→ Loaded spreadsheet (150 rows, 5 columns) — working file: .tsvd-1234567890.tsv
prompt › Add a new column called "Total" that sums Price and Tax
```

`tsvd` will:
1. Show the model's thinking (if extended thinking is enabled)
2. Display used tools and explanation of it's changes
3. Show a colored diff of the proposed changes
4. Ask for your confirmation before applying changes to a working file

To exit, press Enter on an empty line or press Ctrl+C.

You will be prompted to save changes to the original file or a new file.

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

1. **Load**: tsvd reads your TSV file (or stdin) and converts it to an internal table format
2. **Convert**: The table is displayed to the AI model as a markdown table with row numbers and column labels
3. **Edit**: The model uses several tools to make changes:
   - `str_replace`: For precise, surgical edits (must match exactly once)
   - `replace_all`: For major restructuring, sorting, or bulk changes
   - `edit_cells`: For editing specific cells by coordinates
   - `replace_area`: For replacing rectangular regions
4. **Review**: You see a diff of all proposed changes
5. **Apply**: If you approve, changes are saved to a working file
6. **Save**: On exit, you can save to the original file or a new location

You exit tsvd by pressing Enter on an empty line or pressing Ctrl+C.

## Provider Support

tsvd supports multiple AI providers:

- **Anthropic** (Claude): Default when `ANTHROPIC_API_KEY` is set
  - Supports extended thinking with the `claude-sonnet-4-5-20250929` model
  - Uses prompt caching for better performance on large spreadsheets

- **OpenRouter**: Use when `OPENROUTER_API_KEY` is set
  - Access to many models including OpenAI, Anthropic via OpenRouter, and others
  - Supports reasoning/thinking modes where available
  - Specify with `--provider openrouter`

The provider is auto-detected based on which API key is set. Use `--provider` to explicitly choose one when both keys are available.
