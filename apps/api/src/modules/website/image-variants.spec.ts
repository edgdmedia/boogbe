import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { makeVariants } from './image-variants';

// Phone-photo stand-ins, generated (no binary fixtures in the repo — plan Task 5).
// GPS and hasExif/hasGps work at runtime but are not in sharp 0.35's .d.ts yet — hence the casts.
async function portraitJpeg(): Promise<Buffer> {
  const exif = { GPS: { GPSLatitudeRef: 'N', GPSLatitude: '6.3617' } };
  const { data } = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg({ quality: 60 })
    .withExif(exif as never)
    .withMetadata({ orientation: 6 }) // stored 8000×6000, meant to be seen 6000×8000
    .toBuffer({ resolveWithObject: true });
  return data;
}

const jpegAt = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg().toBuffer();

// The 8000×6000 encode/decode takes a few seconds — above vitest's default 5s when the machine is busy.
const BIG = 30_000;

describe('image variants', () => {
  it('orients an 8000×6000 orientation-6 JPEG to 6000×8000 and makes all four widths', async () => {
    const r = await makeVariants(await portraitJpeg());
    expect(r.width).toBe(6000);
    expect(r.height).toBe(8000);
    expect(r.variants.map((v) => v.w)).toEqual([480, 800, 1600, 2400]);
  }, BIG);

  it('strips EXIF and GPS from every variant', async () => {
    const r = await makeVariants(await portraitJpeg());
    for (const v of r.variants) {
      const md = (await sharp(v.body).metadata()) as unknown as Record<string, unknown>;
      expect(md.format).toBe('webp');
      // sharp only reports hasExif/hasGps when they are present — stripped means absent.
      expect(Boolean(md.hasExif)).toBe(false);
      expect(Boolean(md.hasGps)).toBe(false);
    }
  }, BIG);

  it('a 700px-wide PNG only gets the 480 variant', async () => {
    const png = await sharp({ create: { width: 700, height: 500, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .png()
      .toBuffer();
    const r = await makeVariants(png);
    expect(r.width).toBe(700);
    expect(r.variants.map((v) => v.w)).toEqual([480]);
  });

  it('480 is made even for originals narrower than 480', async () => {
    const r = await makeVariants(await jpegAt(300, 200));
    expect(r.variants.map((v) => v.w)).toEqual([480]);
    const md = await sharp(r.variants[0]!.body).metadata();
    expect(md.width).toBe(480);
  });

  it('each variant keeps the aspect ratio at its exact width', async () => {
    const r = await makeVariants(await jpegAt(2500, 1000));
    for (const v of r.variants) {
      const md = await sharp(v.body).metadata();
      expect(md.width).toBe(v.w);
      expect(md.height).toBe(Math.round((v.w * 1000) / 2500));
    }
  });

  it('refuses a non-image buffer', async () => {
    await expect(makeVariants(Buffer.from('this is not a picture'))).rejects.toThrow();
  });
});
