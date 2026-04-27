const REPO = 'morimoto-sho/sora-content-checker';
const FILE_PATH = 'data/status.json';

export default async function handler(req, res) {
  const TOKEN = process.env.GITHUB_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const headers = {
    Authorization: `token ${TOKEN}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'sora-checker'
  };

  // GET - return all items
  if (req.method === 'GET') {
    const resp = await fetch(apiUrl, { headers });
    if (!resp.ok) return res.status(500).json({ error: 'Failed to read data' });
    const file = await resp.json();
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString());
    return res.json(data);
  }

  // PATCH - update one item
  if (req.method === 'PATCH') {
    const { id, status, text } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    // Read current file
    const getResp = await fetch(apiUrl, { headers });
    if (!getResp.ok) return res.status(500).json({ error: 'Failed to read' });
    const file = await getResp.json();
    const data = JSON.parse(Buffer.from(file.content, 'base64').toString());

    // Find and update item
    const item = data.find(d => d.id === id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    if (status !== undefined) item.status = status;
    if (text !== undefined) item.text = text;
    item.updated_at = new Date().toISOString();

    // Write back with retry on conflict
    for (let attempt = 0; attempt < 3; attempt++) {
      const putResp = await fetch(apiUrl, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `update: ${item.id}`,
          content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
          sha: file.sha
        })
      });
      if (putResp.ok) return res.json(item);
      if (putResp.status === 409) {
        // Conflict - re-read and retry
        const retry = await fetch(apiUrl, { headers });
        const f2 = await retry.json();
        file.sha = f2.sha;
        continue;
      }
      return res.status(500).json({ error: 'Failed to save' });
    }
    return res.status(500).json({ error: 'Too many conflicts' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
