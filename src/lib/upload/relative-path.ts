"use client";

/** Relative path captured from directory picker or folder drag-drop. */
export function getFileRelativePath(file: File): string | undefined {
  const custom = (file as File & { dmRelativePath?: string }).dmRelativePath;
  if (custom && custom.trim()) {
    return custom.replace(/\\/g, "/").replace(/^\/+/, "");
  }
  if (file.webkitRelativePath && file.webkitRelativePath.trim()) {
    return file.webkitRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  }
  return undefined;
}

export function setFileRelativePath(file: File, relativePath: string): File {
  Object.defineProperty(file, "dmRelativePath", {
    value: relativePath.replace(/\\/g, "/").replace(/^\/+/, ""),
    configurable: true,
  });
  return file;
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    success: (file: File) => void,
    error?: (err: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      error?: (err: DOMException) => void,
    ) => void;
  };
};

function readAllEntries(reader: {
  readEntries: (
    success: (entries: FileSystemEntryLike[]) => void,
    error?: (err: DOMException) => void,
  ) => void;
}): Promise<FileSystemEntryLike[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntryLike[] = [];
    const pump = () => {
      reader.readEntries(
        (entries) => {
          if (entries.length === 0) {
            resolve(all);
            return;
          }
          all.push(...entries);
          pump();
        },
        (err) => reject(err),
      );
    };
    pump();
  });
}

async function walkEntry(
  entry: FileSystemEntryLike,
  parentPath: string,
  out: File[],
): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file!(resolve, reject);
    });
    const relativePath = parentPath
      ? `${parentPath}/${entry.name}`
      : entry.name;
    setFileRelativePath(file, relativePath);
    out.push(file);
    return;
  }

  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    const children = await readAllEntries(reader);
    const nextParent = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    for (const child of children) {
      await walkEntry(child, nextParent, out);
    }
  }
}

/** Prefer directory entries so folder structure survives drag-drop. */
export async function collectFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  // Snapshot everything synchronously. After the first `await`, Chromium
  // invalidates DataTransfer / DataTransferItemList — awaiting inside the
  // items loop only kept the first dropped file.
  const fallbackFiles = [...dataTransfer.files];
  const items = dataTransfer.items;
  const entries: FileSystemEntryLike[] = [];

  if (items && items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const entry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntryLike | null;
        }
      ).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  if (entries.length === 0) {
    return fallbackFiles;
  }

  const out: File[] = [];
  for (const entry of entries) {
    await walkEntry(entry, "", out);
  }

  if (out.length > 0) return out;
  return fallbackFiles;
}
