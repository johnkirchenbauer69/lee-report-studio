import { create as createFont, type Font, type FontCollection } from "fontkit";
import path from "node:path";
import yauzl from "yauzl";

export const FONT_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
export const MAX_FONT_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 100;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

export interface FontMetadata {
  family: string;
  weight: number;
  style: "normal" | "italic";
  postScriptName: string;
}

export interface FontImportFile {
  name: string;
  buffer: Buffer;
}

export interface FontBundle {
  fonts: FontImportFile[];
  license?: { type?: string; fileName?: string };
}

const normalizeFamily = (value: string) =>
  value
    .replace(/\s+(?:6|8|9|10|11|12|14|16|18|24|32|36|48|60|72|96)pt$/i, "")
    .trim();

export function parseFontMetadata(buffer: Buffer): FontMetadata {
  const parsed = createFont(buffer);
  if ("fonts" in (parsed as FontCollection))
    throw new Error(
      "Font collections are not supported; upload individual font faces.",
    );
  const font = parsed as Font;
  const weight = Math.min(
    1000,
    Math.max(1, font["OS/2"]?.usWeightClass ?? 400),
  );
  const style =
    font.italicAngle !== 0 || /italic|oblique/i.test(font.subfamilyName)
      ? "italic"
      : "normal";
  const nameRecords = (
    font as Font & {
      name?: { records?: { preferredFamily?: Record<string, string> } };
    }
  ).name?.records;
  const preferredFamily = nameRecords?.preferredFamily
    ? Object.values(nameRecords.preferredFamily)[0]
    : undefined;
  const family = normalizeFamily(
    preferredFamily || font.familyName || font.fullName,
  );
  if (!family || !font.postscriptName)
    throw new Error(
      "The file does not contain usable OpenType naming metadata.",
    );
  return { family, weight, style, postScriptName: font.postscriptName };
}

export const isUnsafeZipEntry = (name: string) => {
  const normalized = name.replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").includes("..")
  );
};

export function readFontBundle(buffer: Buffer): Promise<FontBundle> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: true },
      (openError, zip) => {
        if (openError || !zip)
          return reject(
            openError ?? new Error("The ZIP archive could not be opened."),
          );
        const fonts: FontImportFile[] = [];
        let license: FontBundle["license"];
        let entries = 0;
        let totalBytes = 0;
        const fail = (error: Error) => {
          zip.close();
          reject(error);
        };
        zip.on("error", fail);
        zip.on("entry", (entry) => {
          entries += 1;
          totalBytes += entry.uncompressedSize;
          if (entries > MAX_ZIP_ENTRIES)
            return fail(
              new Error(
                `ZIP archives may contain at most ${MAX_ZIP_ENTRIES} entries.`,
              ),
            );
          if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES)
            return fail(
              new Error(
                "The ZIP archive expands beyond the 80 MB safety limit.",
              ),
            );
          if (isUnsafeZipEntry(entry.fileName))
            return fail(
              new Error(`Unsafe ZIP path rejected: ${entry.fileName}`),
            );
          if (/\/$/.test(entry.fileName)) {
            zip.readEntry();
            return;
          }
          const extension = path.extname(entry.fileName).toLowerCase();
          const licenseEntry =
            /(?:^|\/)(?:ofl|license|licence|copying)(?:[-_.]|$)/i.test(
              entry.fileName,
            );
          if (!FONT_EXTENSIONS.has(extension) && !licenseEntry) {
            zip.readEntry();
            return;
          }
          if (
            FONT_EXTENSIONS.has(extension) &&
            entry.uncompressedSize > MAX_FONT_BYTES
          )
            return fail(
              new Error(`${entry.fileName} exceeds the 10 MB font-face limit.`),
            );
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream)
              return fail(
                streamError ?? new Error(`Could not read ${entry.fileName}.`),
              );
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (
                size >
                (FONT_EXTENSIONS.has(extension) ? MAX_FONT_BYTES : 256 * 1024)
              )
                stream.destroy(
                  new Error("Archive entry exceeded its safety limit."),
                );
              else chunks.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              const contents = Buffer.concat(chunks);
              if (FONT_EXTENSIONS.has(extension))
                fonts.push({
                  name: path.basename(entry.fileName),
                  buffer: contents,
                });
              else if (!license) {
                const text = contents.toString("utf8");
                license = {
                  type: /SIL OPEN FONT LICENSE/i.test(text)
                    ? "SIL Open Font License 1.1"
                    : undefined,
                  fileName: path.basename(entry.fileName),
                };
              }
              zip.readEntry();
            });
          });
        });
        zip.on("end", () => {
          if (!fonts.length)
            reject(
              new Error(
                "The ZIP archive does not contain a supported font file.",
              ),
            );
          else resolve({ fonts, license });
        });
        zip.readEntry();
      },
    );
  });
}
