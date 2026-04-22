function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}

function getDesc(project) {
  const cams = Array.isArray(project && project.cameras) ? project.cameras.length : 0;
  const firstList = project && Array.isArray(project.lists) ? project.lists[0] : null;
  const clips = firstList && Array.isArray(firstList.clips) ? firstList.clips.length : 0;
  return cams + ' camara(s) - ' + clips + ' clips';
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

  const project = payload && payload.project;
  const meta = (payload && payload.meta) || {};
  if (!project || typeof project !== 'object') {
    return json({ ok: false, error: 'project requerido' }, 400);
  }

  const id = String(project.id || '').trim();
  const name = String(project.name || id).trim();
  if (!id) {
    return json({ ok: false, error: 'project.id requerido' }, 400);
  }

  await env.UBR_DATA.put('projects/' + id + '.json', JSON.stringify(project, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });

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

  const entry = {
    id: id,
    name: name,
    description: String(meta.description || getDesc(project)),
    file: '/api/project/' + id,
    date: String(meta.date || (project.source && project.source.date) || new Date().toISOString().slice(0, 10)),
    tags: Array.isArray(meta.tags) ? meta.tags : []
  };

  manifest = manifest.filter(function (it) {
    return String((it && it.id) || '') !== id;
  });
  manifest.unshift(entry);

  await env.UBR_DATA.put('manifest.json', JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' }
  });

  const cams = Array.isArray(project.cameras) ? project.cameras.length : 0;
  const firstList = Array.isArray(project.lists) ? project.lists[0] : null;
  const clips = firstList && Array.isArray(firstList.clips) ? firstList.clips.length : 0;

  return json({ ok: true, id: id, name: name, clips: clips, cameras: cams });
}
