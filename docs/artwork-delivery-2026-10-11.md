# Artwork delivery

The supplied metallic Vanteloq, BookLoQ and LexEdge masters remain byte-identical
JPEGs. Their existing SVG viewports frame those pixels without redrawing or
recolouring them. Intrinsic SVG dimensions now preserve their intended ratio
before the stylesheet loads. The Vanteloq AI mark and charts remain native
vectors. Glass surfaces are intentional backgrounds, not a blur applied to
the artwork.

Three large existing PNGs now have full-resolution lossless WebP delivery files.
The original PNGs remain as picture fallbacks and remain available for social
metadata. No crop, resize, upscaling, quantization or colour change occurred.
Every decoded RGBA pixel, including hidden RGB values under full transparency,
is checked against its original. Original hashes are also pinned in the test.

| Artwork | Dimensions | Original bytes | Delivery bytes | Saving |
| --- | --- | ---: | ---: | ---: |
| Greeting smile | 1254 × 1254 | 878,296 | 628,390 | 28.5% |
| POS intelligence | 1774 × 887 | 1,116,716 | 811,236 | 27.4% |
| BookLoQ cash illustration | 1774 × 887 | 1,096,215 | 788,344 | 28.1% |

The combined reduction is 863,257 bytes (27.9%) when all three artworks are
requested. It is not a measured page-speed score or a claim that every page
downloads these files. The same greeting WebP is reused by its CSS mask, so
the visible artwork and shine do not require two different image downloads.

Provider artwork remains unchanged and local. The shared provider component
now supplies actual intrinsic dimensions, lazy loading and asynchronous
decoding. Google and Plaid may select their existing larger originals on a
high-density screen. Most other marks are genuine SVGs and scale without
resolution loss. Lightspeed's previous 30 × 44 pixel raster has been replaced
with the complete official charcoal vector wordmark from its public media kit.
The 3,458-byte SVG is byte-identical to the provider download, uses its original
charcoal colour, and sits on a neutral carrier. Its flame and wordmark remain
together, with no cropping, recolouring, upscaling or certified-partner badge.

Lightspeed source: https://brand.lightspeedhq.com/document/151#/media-kit/resources.
The provider archive is `Assets 2026-10-12.zip`, downloaded through its official
Media Kit. The installed member is
`Lightspeed_Logo_Charcoal attachments/Lightspeed_Logo_Charcoal.svg`.
SHA-256: `35087805d3de2d8522477857158d6c19c89ff04b0f10eb7ad6c937ae307e31ff`.
The archive name reflects the download service's UTC date; the source review
was completed on October 11, 2026 in America/Denver.

The existing product film is 1920 × 1080 and remains user-started with
`preload="none"`; the existing full-resolution poster is 92,634 bytes.
Increasing these files beyond their real source resolution would not add
detail. The metallic logo JPEGs are already lean (63,849 bytes for Vanteloq,
63,415 for BookLoQ and 78,096 for LexEdge). Lossless WebP encoding made those
files larger, so they were deliberately left unchanged.

To regenerate the delivery files, run `python scripts/encode-public-artwork.py`
with Pillow and libwebp installed. This is a development-only format encoder,
not a production request handler. It refuses changed colour profiles,
orientation, pixel values, dimensions or a file that is not smaller.
