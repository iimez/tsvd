import { colors } from '@cliffy/ansi/colors'

// Custom readline that handles Ctrl+C gracefully with enhanced editing
export async function readLine(prompt: string): Promise<string | null> {
	const encoder = new TextEncoder()
	const decoder = new TextDecoder()

	// Write prompt
	await Deno.stdout.write(encoder.encode(prompt))

	// Set raw mode for terminal
	try {
		Deno.stdin.setRaw(true)
	} catch (err) {
		// If raw mode fails (e.g., not a TTY), fall back to simple input
		const message = err instanceof Error ? err.message : String(err)
		console.error(`Warning: Could not enable raw mode: ${message}`)
		console.error('Falling back to simple input mode.')

		// Simple fallback: just read a line without fancy editing
		const buf = new Uint8Array(1024)
		const n = await Deno.stdin.read(buf)
		if (n === null) return null

		const decoder = new TextDecoder()
		const line = decoder.decode(buf.slice(0, n)).trim()
		return line
	}

	let buffer = ''
	let cursorPos = 0

	// Helper to redraw the line from cursor position
	const redrawLine = async () => {
		const afterCursor = buffer.slice(cursorPos)
		const remaining = buffer.length - cursorPos

		// Clear to end of line, write remaining text, move cursor back
		await Deno.stdout.write(
			encoder.encode(
				`${afterCursor}\x1b[K${
					remaining > 0 ? `\x1b[${remaining}D` : ''
				}`,
			),
		)
	}

	try {
		const buf = new Uint8Array(32) // Read up to 32 bytes for escape sequences

		while (true) {
			const n = await Deno.stdin.read(buf)
			if (n === null || n === 0) break

			const code = buf[0]

			// Ctrl+C
			if (code === 3) {
				Deno.stdin.setRaw(false)
				await Deno.stdout.write(encoder.encode('^C\n'))
				return null
			}

			// Enter
			if (code === 13 || code === 10) {
				await Deno.stdout.write(encoder.encode('\n'))
				Deno.stdin.setRaw(false)
				return buffer
			}

			// Escape sequences (arrow keys, etc.)
			if (code === 27 && n >= 3 && buf[1] === 91) {
				// ESC [
				const escCode = buf[2]

				// Delete key (ESC[3~)
				if (escCode === 51 && n >= 4 && buf[3] === 126) {
					if (cursorPos < buffer.length) {
						buffer = buffer.slice(0, cursorPos) +
							buffer.slice(cursorPos + 1)
						await redrawLine()
					}
					continue
				}

				// Left arrow
				if (escCode === 68) {
					// D
					if (cursorPos > 0) {
						cursorPos--
						await Deno.stdout.write(encoder.encode('\x1b[D'))
					}
					continue
				}

				// Right arrow
				if (escCode === 67) {
					// C
					if (cursorPos < buffer.length) {
						cursorPos++
						await Deno.stdout.write(encoder.encode('\x1b[C'))
					}
					continue
				}

				// Home (sometimes sent as ESC[1~)
				if (
					escCode === 72 ||
					(escCode === 49 && n >= 4 && buf[3] === 126)
				) {
					if (cursorPos > 0) {
						await Deno.stdout.write(
							encoder.encode(`\x1b[${cursorPos}D`),
						)
						cursorPos = 0
					}
					continue
				}

				// End (sometimes sent as ESC[4~)
				if (
					escCode === 70 ||
					(escCode === 52 && n >= 4 && buf[3] === 126)
				) {
					const diff = buffer.length - cursorPos
					if (diff > 0) {
						await Deno.stdout.write(encoder.encode(`\x1b[${diff}C`))
						cursorPos = buffer.length
					}
					continue
				}

				continue
			}

			// Alt+Backspace (ESC followed by backspace) for word deletion
			if (code === 27 && n >= 2 && (buf[1] === 127 || buf[1] === 8)) {
				if (cursorPos > 0) {
					const beforeCursor = buffer.slice(0, cursorPos)
					const match = beforeCursor.match(/\S+\s*$/) // simpler and more predictable
					if (match) {
						const deleteCount = match[0].length
						buffer = buffer.slice(0, cursorPos - deleteCount) +
							buffer.slice(cursorPos)
						await Deno.stdout.write(
							encoder.encode(`\x1b[${deleteCount}D`),
						)
						cursorPos -= deleteCount
						await redrawLine()
					}
				}
				continue
			}

			// Ctrl+Backspace (sometimes sends 0x08 or 0x1f)
			if (code === 8 || code === 31) {
				if (cursorPos > 0) {
					const beforeCursor = buffer.slice(0, cursorPos)
					const match = beforeCursor.match(/\S+\s*$/) // simpler and more predictable
					if (match) {
						const deleteCount = match[0].length
						buffer = buffer.slice(0, cursorPos - deleteCount) +
							buffer.slice(cursorPos)
						await Deno.stdout.write(
							encoder.encode(`\x1b[${deleteCount}D`),
						)
						cursorPos -= deleteCount
						await redrawLine()
					}
				}
				continue
			}

			// Ctrl+W (delete word backwards) - alternative to Alt+Backspace
			if (code === 23) {
				if (cursorPos > 0) {
					const beforeCursor = buffer.slice(0, cursorPos)
					const match = beforeCursor.match(/\S+\s*$/) // simpler and more predictable
					if (match) {
						const deleteCount = match[0].length
						buffer = buffer.slice(0, cursorPos - deleteCount) +
							buffer.slice(cursorPos)
						await Deno.stdout.write(
							encoder.encode(`\x1b[${deleteCount}D`),
						)
						cursorPos -= deleteCount
						await redrawLine()
					}
				}
				continue
			}

			// Ctrl+A (go to beginning)
			if (code === 1) {
				if (cursorPos > 0) {
					await Deno.stdout.write(
						encoder.encode(`\x1b[${cursorPos}D`),
					)
					cursorPos = 0
				}
				continue
			}

			// Ctrl+E (go to end)
			if (code === 5) {
				const diff = buffer.length - cursorPos
				if (diff > 0) {
					await Deno.stdout.write(encoder.encode(`\x1b[${diff}C`))
					cursorPos = buffer.length
				}
				continue
			}

			// Ctrl+U (delete from cursor to beginning of line)
			if (code === 21) {
				if (cursorPos > 0) {
					buffer = buffer.slice(cursorPos)
					await Deno.stdout.write(
						encoder.encode(`\x1b[${cursorPos}D`),
					)
					cursorPos = 0
					await redrawLine()
				}
				continue
			}

			// Ctrl+K (delete from cursor to end of line)
			if (code === 11) {
				if (cursorPos < buffer.length) {
					buffer = buffer.slice(0, cursorPos)
					await Deno.stdout.write(encoder.encode('\x1b[K'))
				}
				continue
			}

			// Backspace (127) or Delete (8)
			if (code === 127 || code === 8) {
				if (cursorPos > 0) {
					buffer = buffer.slice(0, cursorPos - 1) +
						buffer.slice(cursorPos)
					cursorPos--
					await Deno.stdout.write(encoder.encode('\x1b[D'))
					await redrawLine()
				}
				continue
			}

			// Regular printable characters
			if (code >= 32 && code <= 126) {
				const char = decoder.decode(buf.slice(0, 1))
				buffer = buffer.slice(0, cursorPos) + char +
					buffer.slice(cursorPos)
				cursorPos++
				await Deno.stdout.write(encoder.encode(char))
				await redrawLine()
			} else if (code >= 128) {
				// UTF-8 multi-byte
				// Determine byte length based on first byte
				let byteLength = 1
				if (code >= 0xf0) byteLength = 4
				else if (code >= 0xe0) byteLength = 3
				else if (code >= 0xc0) byteLength = 2

				if (n >= byteLength) {
					const char = decoder.decode(buf.slice(0, byteLength))
					buffer = buffer.slice(0, cursorPos) + char +
						buffer.slice(cursorPos)
					cursorPos++
					await Deno.stdout.write(encoder.encode(char))
					await redrawLine()
				}
			}
		}
	} finally {
		Deno.stdin.setRaw(false)
	}

	return buffer
}
