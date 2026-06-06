declare module 'gifenc' {
  export type GIFPalette = number[][];

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: GIFPalette;
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        colorDepth?: number;
        dispose?: number;
      }
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GIFEncoderInstance;
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): GIFPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GIFPalette, format?: string): Uint8Array;
}
