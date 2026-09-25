// A picked file's text, for the theme and template imports (Manage and the host console): UTF-16 when it starts with
// that byte order mark (FE FF or FF FE, as some editors save), else UTF-8.
export async function fileText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}
