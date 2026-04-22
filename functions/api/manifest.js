export async function onRequestGet(context) {
  const { env } = context;
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  };

  if (!env || !env.UBR_DATA || typeof env.UBR_DATA.get !== 'function') {
    return new Response('[]', { status: 200, headers });
  }

  let obj;
  try {
    obj = await env.UBR_DATA.get('manifest.json');
  } catch (_e) {
    return new Response('[]', { status: 200, headers });
  }

  if (!obj) {
    return new Response('[]', { status: 200, headers });
  }

  const text = await obj.text();
  return new Response(text || '[]', { status: 200, headers });
}
