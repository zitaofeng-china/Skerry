const BY_EXT = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image', '.ico': 'image', '.bmp': 'image',
  '.md': 'text', '.markdown': 'text', '.txt': 'text', '.rst': 'text',
  '.js': 'code', '.mjs': 'code', '.cjs': 'code', '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
  '.py': 'code', '.go': 'code', '.rs': 'code', '.java': 'code', '.kt': 'code', '.swift': 'code',
  '.c': 'code', '.h': 'code', '.cpp': 'code', '.cs': 'code', '.rb': 'code', '.php': 'code',
  '.sh': 'code', '.zsh': 'code', '.ps1': 'code',
  '.json': 'data', '.yml': 'data', '.yaml': 'data', '.toml': 'data', '.xml': 'data', '.csv': 'data',
  '.html': 'web', '.css': 'web', '.scss': 'web',
  '.pdf': 'pdf',
  '.doc': 'office', '.docx': 'office', '.xls': 'office', '.xlsx': 'office', '.ppt': 'office', '.pptx': 'office',
  '.zip': 'archive', '.tar': 'archive', '.gz': 'archive', '.7z': 'archive', '.rar': 'archive',
};

export function fileKind(name, type) {
  if (type === 'directory') return 'directory';
  const ext = String(name || '').includes('.') ? `.${String(name).split('.').pop().toLowerCase()}` : '';
  return BY_EXT[ext] || 'file';
}
