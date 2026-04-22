export async function onRequestGet(context) {
  const { env, params } = context;
  const store = env && (env.UBR_STORE || env.UBR_DATA);
  const id = String(params.id || '').trim();
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'id requerido' }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  }

  if (!store || typeof store.get !== 'function') {
    return new Response(JSON.stringify({ ok: false, error: 'binding R2 no configurado' }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }

  const key = 'projects/' + id + '.json';
  const obj = await store.get(key);
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
