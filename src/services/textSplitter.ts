import JSZip from 'jszip';

export interface SplitPart {
  partIndex: number;
  totalParts: number;
  filename: string;
  content: string;
  byteLength: number;
}

/**
 * Splits text safely at file boundary blocks (`================================================\nFile: ...`)
 * so individual file contents are never corrupted or cut in half.
 *
 * @param text The full digest text (summary + tree + file contents)
 * @param maxBytes Maximum byte size per output chunk (up to 1GB = 1024 * 1024 * 1024 bytes)
 * @param baseFilename Base filename to derive part filenames from, e.g. "repo_digest.txt"
 */
export function splitDigestSafely(
  text: string,
  maxBytes: number,
  baseFilename: string
): SplitPart[] {
  const encoder = new TextEncoder();
  const totalByteLength = encoder.encode(text).length;

  if (totalByteLength <= maxBytes) {
    return [
      {
        partIndex: 1,
        totalParts: 1,
        filename: baseFilename,
        content: text,
        byteLength: totalByteLength,
      },
    ];
  }

  const fileDelimiter = '================================================\nFile: ';
  const parts: string[] = [];

  // Check if text contains standard GitDigest file blocks
  if (text.includes(fileDelimiter)) {
    const firstDelimiterIndex = text.indexOf(fileDelimiter);
    const headerPrefix = text.slice(0, firstDelimiterIndex); // Summary + Tree structure
    const rawFileBlocks = text.slice(firstDelimiterIndex).split(fileDelimiter).filter(Boolean);

    let currentChunk = headerPrefix;
    let currentBytes = encoder.encode(currentChunk).length;

    for (let i = 0; i < rawFileBlocks.length; i++) {
      const blockText = fileDelimiter + rawFileBlocks[i];
      const blockBytes = encoder.encode(blockText).length;

      // If adding this file block exceeds maxBytes and currentChunk already has content
      if (currentBytes + blockBytes > maxBytes && currentChunk.length > 0) {
        parts.push(currentChunk);
        // Start next chunk with header reminder
        currentChunk = `[Continued digest part - Header & structure repeated]\n${headerPrefix.trimEnd()}\n\n${blockText}`;
        currentBytes = encoder.encode(currentChunk).length;
      } else {
        currentChunk += blockText;
        currentBytes += blockBytes;
      }
    }

    if (currentChunk.trim().length > 0) {
      parts.push(currentChunk);
    }
  } else {
    // Fallback: split by line breaks safely without cutting UTF-8 multi-byte characters
    const lines = text.split('\n');
    let currentChunk = '';
    let currentBytes = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineWithNewline = (i === 0 ? '' : '\n') + lines[i];
      const lineBytes = encoder.encode(lineWithNewline).length;

      if (currentBytes + lineBytes > maxBytes && currentChunk.length > 0) {
        parts.push(currentChunk);
        currentChunk = lines[i];
        currentBytes = encoder.encode(currentChunk).length;
      } else {
        currentChunk += lineWithNewline;
        currentBytes += lineBytes;
      }
    }

    if (currentChunk.length > 0) {
      parts.push(currentChunk);
    }
  }

  const totalParts = Math.max(parts.length, 1);
  const baseNameWithoutExt = baseFilename.replace(/\.txt$/i, '');

  return parts.map((content, idx) => {
    const partNum = idx + 1;
    const filename = `${baseNameWithoutExt}_part${partNum}_of_${totalParts}.txt`;
    const byteLength = encoder.encode(content).length;
    return {
      partIndex: partNum,
      totalParts,
      filename,
      content,
      byteLength,
    };
  });
}

/**
 * Downloads multiple split text files as a single .zip archive containing all parts,
 * preventing browser pop-up blockers from swallowing multiple sequential download prompts.
 */
export async function downloadSplitPartsAsZip(
  parts: SplitPart[],
  zipFilename: string
): Promise<void> {
  const zip = new JSZip();

  for (const part of parts) {
    zip.file(part.filename, part.content);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = zipFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
