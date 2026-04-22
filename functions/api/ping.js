export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, source: 'ping' }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });
}
