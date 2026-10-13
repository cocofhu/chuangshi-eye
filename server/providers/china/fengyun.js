import { readResponseBytesCapped } from '../common/http.js';
import { sameSiteGated } from '../common/same-site.js';
import {
  FY4B_GRID_4KM,
  FY4B_SUB_LONGITUDE,
  FENGYUN_ATTRIBUTION,
  fengyunObservedAt,
  fengyunRectangle,
  reprojectDisk,
} from '../../../src/china/fengyun.js';

export const FY4B_DISK_URL =
  'https://img.nsmc.org.cn/CLOUDIMAGE/FY4B/AGRI/GCLR/FY4B_DISK_GCLR.JPG';
const CHECK_MS = 10 * 60_000;
const MAX_DISK_BYTES = 40 * 1024 * 1024;
const OUTPUT_SIZE = 2048;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; chuangshi-eye/0.1)',
  Referer: 'https://www.nsmc.org.cn/',
};

async function defaultRender(jpeg) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(jpeg, { limitInputPixels: false })
    .resize(FY4B_GRID_4KM.size)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = reprojectDisk(data, info, {
    outWidth: OUTPUT_SIZE,
    outHeight: OUTPUT_SIZE,
  });
  return sharp(Buffer.from(rgba.buffer), {
    raw: { width: OUTPUT_SIZE, height: OUTPUT_SIZE, channels: 4 },
  })
    .webp({ quality: 78, alphaQuality: 60 })
    .toBuffer();
}

/**
 * GET /api/fengyun/status and /api/fengyun/fy4b.webp: the latest FY-4B
 * true-colour full disk, reprojected once per upstream update and shared by
 * every viewer. Upstream is checked with HEAD at most every ten minutes and
 * the 20 MB disk is downloaded only when Last-Modified changes.
 */
export function fengyunProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  render = defaultRender,
  timeoutMs = 60_000,
} = {}) {
  let image = null;
  let checkedAt = -Infinity;
  let inflight = null;

  async function refresh() {
    const head = await fetchImpl(FY4B_DISK_URL, {
      method: 'HEAD',
      redirect: 'error',
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
    const lastModified = head.headers.get('last-modified');
    if (!head.ok) throw new Error(`fengyun_head_${head.status}`);
    checkedAt = now();
    if (image && image.lastModified === lastModified) return image;
    const response = await fetchImpl(FY4B_DISK_URL, {
      redirect: 'error',
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !type.startsWith('image/jpeg')) {
      await response.body?.cancel();
      throw new Error(`fengyun_upstream_${response.status}`);
    }
    const jpeg = await readResponseBytesCapped(response, MAX_DISK_BYTES);
    const webp = await render(Buffer.from(jpeg));
    image = {
      webp,
      lastModified: response.headers.get('last-modified') || lastModified,
      observedAt: fengyunObservedAt(
        response.headers.get('last-modified') || lastModified,
      ),
      renderedAt: now(),
    };
    return image;
  }

  async function acquire() {
    if (image && now() - checkedAt < CHECK_MS) return image;
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    try {
      return await inflight;
    } catch (error) {
      checkedAt = now() - CHECK_MS + 60_000;
      if (image) return image;
      throw error;
    }
  }

  async function handler(req, res) {
    const send = (status, type, body, extra = {}) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': type, ...extra });
      res.end(body);
    };
    const json = (status, value) =>
      send(status, 'application/json', JSON.stringify(value), {
        'Cache-Control': 'no-store',
      });
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const urlPath = String(req.url || '').split('?')[0];
    if (urlPath !== '/status' && urlPath !== '/fy4b.webp')
      return json(404, { error: 'not_found' });
    try {
      const value = await acquire();
      if (urlPath === '/status')
        return json(200, {
          available: true,
          satellite: 'FY-4B',
          subLongitude: FY4B_SUB_LONGITUDE,
          rectangle: fengyunRectangle(),
          observedAt: value.observedAt,
          renderedAt: value.renderedAt,
          attribution: FENGYUN_ATTRIBUTION,
        });
      send(200, 'image/webp', value.webp, {
        'Cache-Control': 'private, max-age=300',
        'Content-Length': String(value.webp.length),
      });
    } catch (error) {
      console.warn('[fengyun] unavailable:', error?.message || error);
      json(502, { error: 'upstream', available: false });
    }
  }

  const gated = sameSiteGated(handler);
  return {
    name: 'fengyun-cloud',
    configureServer({ middlewares }) {
      middlewares.use('/api/fengyun', gated);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/fengyun', gated);
    },
  };
}
