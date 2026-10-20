import sharp from 'sharp';

/** Variant widths published for every photo (Global Constraints). Only widths the oriented original
 *  can fill are made; 480 is always made, even if that means enlarging. */
export const VARIANT_WIDTHS = [480, 800, 1600, 2400] as const;

export interface ImageVariants {
  /** Output dimensions AFTER EXIF orientation — what the page's aspect ratio uses. */
  width: number;
  height: number;
  variants: { w: number; body: Buffer }[];
}

/**
 * Pure resize pipeline (plan: no I/O here). `.rotate()` applies the EXIF orientation and drops the
 * tag; nothing calls `withMetadata`, so the WebP outputs carry no EXIF — a phone photo's GPS must
 * never reach the public bucket. Throws on anything libvips can't decode.
 */
export async function makeVariants(input: Buffer): Promise<ImageVariants> {
  const oriented = await sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const width = oriented.info.width!;
  const height = oriented.info.height!;
  const variants: { w: number; body: Buffer }[] = [];
  for (const w of VARIANT_WIDTHS) {
    if (w !== 480 && w > width) continue;
    const { data } = await sharp(oriented.data)
      .resize({ width: w })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    variants.push({ w, body: data });
  }
  return { width, height, variants };
}
