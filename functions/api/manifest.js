export async function onRequestGet(context) {
  const { env } = context;
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  };

  const store = env && (env.UBR_STORE || env.UBR_DATA);

  if (!store || typeof store.get !== 'function') {
    return new Response('[]', { status: 200, headers });
  }

  let obj;
  try {
    obj = await store.get('manifest.json');
  } catch (_e) {
    return new Response('[]', { status: 200, headers });
  }

  if (!obj) {
    return new Response('[]', { status: 200, headers });
  }

  const text = await obj.text();
  return new Response(text || '[]', { status: 200, headers });
}
