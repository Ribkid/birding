const BASE = 'https://api.ebird.org/v2/';
const CACHE = 's-maxage=3600, stale-while-revalidate=86400';
const LOC_ID = /^L\d{1,10}$/;
// eBird normally answers in well under a second; a stalled upstream must not hold the function open.
export const TIMEOUT_MS = 8000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', CACHE);

  const { recent, list } = req.query ?? {};
  if ((recent != null && list != null) || (recent == null && list == null)) {
    return res.status(400).json({ error: 'Choose one hotspot query' });
  }
  const locId = recent ?? list;
  if (typeof locId !== 'string' || !LOC_ID.test(locId)) {
    return res.status(400).json({ error: 'Invalid hotspot id' });
  }

  const path = recent != null
    ? `data/obs/${locId}/recent?back=30`
    : `product/spplist/${locId}`;
  try {
    const response = await fetch(new URL(path, BASE), {
      headers: { 'X-eBirdApiToken': process.env.EBIRD_API_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('Upstream request failed');
    const data = await response.json();
    // An error page or a rate-limit notice parses as JSON: only an array is a real answer.
    if (!Array.isArray(data)) throw new Error('Unexpected eBird response');
    if (recent != null) {
      return res.status(200).json(data.map((obs) => ({
        code: obs.speciesCode,
        sci: obs.sciName,
        name: obs.comName,
        date: obs.obsDt,
        n: obs.howMany ?? 1,
      })));
    }
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: 'eBird unavailable' });
  }
}
