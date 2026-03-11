export type PdfSource = Uint8Array | string | undefined;

export function resolvePdfSource(
  fileData?: Uint8Array,
  fileUrl?: string,
  allowUrlFallback = true,
): PdfSource {
  if (fileData && fileData.length > 0) {
    return fileData;
  }
  if (allowUrlFallback && fileUrl) {
    return fileUrl;
  }
  return undefined;
}
