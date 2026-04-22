export async function onRequestGet(context) {
  const { env } = context;
  const obj = await env.UBR_DATA.get('manifest.json');
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  };

  if (!obj) {
    return new Response('[]', { status: 200, headers });
  }

  const text = await obj.text();
  return new Response(text || '[]', { status: 200, headers });
}
