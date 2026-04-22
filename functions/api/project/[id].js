export async function onRequestGet(context) {
  const { env, params } = context;
  const id = String(params.id || '').trim();
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'id requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  const key = 'projects/' + id + '.json';
  const obj = await env.UBR_DATA.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ ok: false, error: 'proyecto no encontrado' }), {
      status: 404,
      headers: { 'content-type': 'application/json' }
    });
  }

  const text = await obj.text();
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}
