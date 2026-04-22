function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  const apiKey = String(request.headers.get('x-admin-key') || '').trim();
  if (!env.ADMIN_API_KEY || apiKey !== String(env.ADMIN_API_KEY)) {
    return json({ ok: false, error: 'no autorizado' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ ok: false, error: 'json invalido' }, 400);
  }

  const id = String((payload && payload.id) || '').trim();
  const name = String((payload && payload.name) || '').trim();
  if (!id || !name) {
    return json({ ok: false, error: 'id y name requeridos' }, 400);
  }

  const manifestObj = await env.UBR_DATA.get('manifest.json');
  let manifest = [];
  if (manifestObj) {
    try {
      manifest = JSON.parse(await manifestObj.text());
    } catch (_) {
      manifest = [];
    }
  }
  if (!Array.isArray(manifest)) manifest = [];

  let found = false;
  manifest = manifest.map(function (it) {
    if (String((it && it.id) || '') === id) {
      found = true;
      return Object.assign({}, it, { name: name });
    }
    return it;
  });

  if (!found) {
    return json({ ok: false, error: 'proyecto no encontrado en manifest' }, 404);
  }

  await env.UBR_DATA.put('manifest.json', JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });

  const pKey = 'projects/' + id + '.json';
  const projectObj = await env.UBR_DATA.get(pKey);
  if (projectObj) {
    try {
      const project = JSON.parse(await projectObj.text());
      project.name = name;
      await env.UBR_DATA.put(pKey, JSON.stringify(project, null, 2), {
        httpMetadata: { contentType: 'application/json' }
      });
    } catch (_) {}
  }

  return json({ ok: true, id: id, name: name });
}
