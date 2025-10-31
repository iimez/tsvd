type Cell = string
type Row = Cell[]
export type Table = Row[]

// Parse TSV file into 2D array
export function parseTSV(content: string): Table {
	const lines = content.split('\n')
	const table: Table = []

	for (const line of lines) {
		// Split by tabs, treat cells with tabs as empty
		const cells = line
			.split('\t')
			.map((cell) => (cell.includes('\t') ? '' : cell))
		table.push(cells)
	}

	// Remove only the final empty row if file ends with newline
	if (
		table.length > 0 &&
		table[table.length - 1].length === 1 &&
		table[table.length - 1][0] === ''
	) {
		table.pop()
	}

	return table
}

// Convert 2D array to TSV string
export function tableToTSV(table: Table): string {
	return table.map((row) => row.join('\t')).join('\n') + '\n'
}

// Generate column labels A, B, C, ..., Z, AA, AB, ..., ZZ, AAA, etc.
// Works like Excel column labeling
function indexToColumnLabel(index: number): string {
	let label = ''
	let num = index + 1 // Convert to 1-based

	while (num > 0) {
		num-- // Adjust for 0-based modulo
		label = String.fromCharCode(65 + (num % 26)) + label
		num = Math.floor(num / 26)
	}

	return label
}

// Helper to convert column labels (A, B, AA, etc.) to zero-based indices
export function columnLabelToIndex(label: string): number {
	let result = 0
	for (let i = 0; i < label.length; i++) {
		result = result * 26 + (label.charCodeAt(i) - 64)
	}
	return result - 1
}

// Convert table to markdown with row numbers and column labels
export function tableToMarkdown(table: Table): string {
	if (table.length === 0) return ''

	const numCols = Math.max(...table.map((row) => row.length))

	// Header row with column labels
	const headers = [
		'',
		...Array.from({ length: numCols }, (_, i) => indexToColumnLabel(i)),
	]
	const headerRow = '| ' + headers.join(' | ') + ' |'

	// Separator row
	const separator = '| ' + headers.map(() => '---').join(' | ') + ' |'

	// Data rows with row numbers
	const dataRows = table.map((row, rowIndex) => {
		const paddedRow = [...row]
		// Pad row to have same number of columns
		while (paddedRow.length < numCols) {
			paddedRow.push('')
		}
		const cells = [
			String(rowIndex + 1),
			...paddedRow.map((cell) => cell || ' '),
		]
		return '| ' + cells.join(' | ') + ' |'
	})

	return [headerRow, separator, ...dataRows].join('\n')
}

// Parse markdown table back to 2D array
export function markdownToTable(markdown: string): Table {
	const lines = markdown.trim().split('\n')
	const table: Table = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim()

		// Skip separator lines (contain only -, |, and spaces)
		if (/^[\s|\-]+$/.test(line)) continue

		// Skip header row (first non-separator row)
		if (i === 0) continue

		// Parse data rows
		const cells = line
			.split('|')
			.map((cell) => cell.trim())
			.filter((_, index, arr) => index > 0 && index < arr.length - 1) // Remove first/last empty

		// Skip row number (first cell)
		const dataCells = cells.slice(1).map((
			cell,
		) => (cell === ' ' ? '' : cell))
		table.push(dataCells)
	}

	return table
}
