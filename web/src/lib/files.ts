import type { Attachment, AttachmentKind } from './types';

const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/html', 'text/css', 'text/csv', 'text/xml',
  'application/json', 'application/xml', 'application/javascript', 'application/typescript',
  'application/x-yaml', 'application/yaml',
]);

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'json', 'jsonc', 'json5',
  'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'csv', 'tsv',
  'xml', 'svg',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx',
  'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1',
  'sql', 'graphql', 'gql',
  'env', 'gitignore', 'dockerignore', 'editorconfig',
  'log',
]);

const IMAGE_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/bmp', 'image/ico', 'image/avif',
]);

export function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function isImage(mime: string, ext: string): boolean {
  return IMAGE_MIMES.has(mime) || IMAGE_MIMES.has('image/' + ext);
}

export function isText(mime: string, ext: string): boolean {
  if (mime.startsWith('text/')) return true;
  if (TEXT_MIMES.has(mime)) return true;
  if (TEXT_EXTS.has(ext)) return true;
  return false;
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

async function pdfToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
  const { DocuText } = await import('docutext');
  const doc = DocuText.fromBuffer(new Uint8Array(arrayBuffer));
  try {
    const { docToMarkdown } = await import('docutext/markdown');
    return docToMarkdown(doc);
  } catch {
    return doc.text;
  }
}

export async function processFile(file: File): Promise<Attachment> {
  const ext = getExt(file.name);
  const mime = file.type || 'application/octet-stream';
  const size = file.size;

  if (mime === 'application/pdf' || ext === 'pdf') {
    const buf = await readAsArrayBuffer(file);
    const md = await pdfToMarkdown(buf);
    return { name: file.name, mime: 'application/pdf', kind: 'pdf-md', data: md, size };
  }

  if (isImage(mime, ext)) {
    const data = await readAsDataURL(file);
    return { name: file.name, mime, kind: 'image', data, size };
  }

  if (isText(mime, ext) && size < 512 * 1024) {
    const data = await readAsText(file);
    return { name: file.name, mime: mime || 'text/plain', kind: 'text', data, size };
  }

  const data = await readAsDataURL(file);
  return { name: file.name, mime, kind: 'file', data, size };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

export function attachmentLabel(a: Attachment): string {
  switch (a.kind) {
    case 'pdf-md': return 'PDF';
    case 'image': return 'Image';
    case 'text': return 'Text';
    case 'file': return 'File';
  }
}

export function fileIcon(a: Attachment): string {
  if (a.kind === 'image') return '🖼';
  if (a.kind === 'pdf-md') return '📄';
  if (a.kind === 'text') {
    const ext = getExt(a.name);
    if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return '📜';
    if (['html', 'htm'].includes(ext)) return '🌐';
    if (['css', 'scss', 'sass'].includes(ext)) return '🎨';
    if (['json', 'xml', 'yml', 'yaml', 'toml'].includes(ext)) return '⚙';
    return '📃';
  }
  return '📎';
}
