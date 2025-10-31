import { StreamTextTransform, TextStreamPart, ToolSet } from 'ai'

/**
 * Creates a transform stream that trims leading and trailing whitespace from text sections.
 * Buffers text-delta chunks to ensure trailing whitespace is only removed at section boundaries.
 *
 * @returns A transform stream that removes whitespace from start/end of text sections
 */
export function trimWhitespaceTransform<
	TOOLS extends ToolSet,
>(): StreamTextTransform<TOOLS> {
	return () => {
		let isStartOfTextSection = true
		let bufferedChunk: TextStreamPart<TOOLS> | null = null

		const enqueueBuffered = (
			controller: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
			trimEnd = false,
		) => {
			if (bufferedChunk !== null && bufferedChunk.type === 'text-delta') {
				const text = trimEnd
					? bufferedChunk.text.trimEnd()
					: bufferedChunk.text
				controller.enqueue({ ...bufferedChunk, text: text })
				bufferedChunk = null
			}
		}

		return new TransformStream<
			TextStreamPart<TOOLS>,
			TextStreamPart<TOOLS>
		>({
			transform(chunk, controller) {
				if (chunk.type === 'text-delta') {
					// Enqueue previously buffered chunk
					enqueueBuffered(controller, false)

					// Process current chunk - trim start if beginning of section
					const processedText = isStartOfTextSection
						? chunk.text.trimStart()
						: chunk.text

					isStartOfTextSection = false

					// Buffer this chunk (might need end-trimming later)
					bufferedChunk = { ...chunk, text: processedText }
				} else {
					// Flush buffered text chunk with trailing whitespace removed
					enqueueBuffered(controller, true)

					// Reset for next text section
					isStartOfTextSection = true

					// Pass through non-text chunks
					controller.enqueue(chunk)
				}
			},

			flush(controller) {
				// Flush final buffered chunk with trailing whitespace removed
				enqueueBuffered(controller, true)
			},
		})
	}
}
