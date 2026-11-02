// Minimal local typings for busboy 1.6.0 (the ONE approved multipart library, Prompt 7). Written from its
// README (node_modules/busboy/README.md, "API") instead of installing @types/busboy, which would be a second
// dependency. Only what src/approval/web/multipart.ts uses is declared.

declare module 'busboy' {
  import type { IncomingHttpHeaders } from 'node:http';
  import type { Readable, Writable } from 'node:stream';

  interface BusboyLimits {
    fieldNameSize?: number;
    fieldSize?: number;
    fields?: number;
    fileSize?: number;
    files?: number;
    parts?: number;
    headerPairs?: number;
  }

  interface BusboyConfig {
    headers: IncomingHttpHeaders;
    highWaterMark?: number;
    fileHwm?: number;
    defCharset?: string;
    defParamCharset?: string;
    preservePath?: boolean;
    limits?: BusboyLimits;
  }

  interface FileInfo {
    filename: string;
    encoding: string;
    mimeType: string;
  }

  interface FieldInfo {
    nameTruncated: boolean;
    valueTruncated: boolean;
    encoding: string;
    mimeType: string;
  }

  /** The file stream: `truncated` becomes true (and 'limit' is emitted) when limits.fileSize was reached. */
  type FileStream = Readable & { truncated?: boolean };

  interface Busboy extends Writable {
    on(event: 'file', listener: (name: string, stream: FileStream, info: FileInfo) => void): this;
    on(event: 'field', listener: (name: string, value: string, info: FieldInfo) => void): this;
    on(event: 'partsLimit' | 'filesLimit' | 'fieldsLimit' | 'close' | 'finish', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    // biome-ignore lint/suspicious/noExplicitAny: Writable's own generic event overload (listener args vary by event).
    on(event: string | symbol, listener: (...args: any[]) => void): this;
  }

  /** Throws when the Content-Type is missing, unsupported, or has no multipart boundary. */
  function busboy(config: BusboyConfig): Busboy;
  export default busboy;
}
