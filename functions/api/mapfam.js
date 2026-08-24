// Cloudflare Pages Function — handles Mapfam's shared image gallery.
// Deployed automatically by Cloudflare Pages at: /api/mapfam
// (Any file under functions/ becomes a route automatically — this file's
// path, functions/api/mapfam.js, is what makes it live at /api/mapfam.)
//
// Requires, set up via the Pages dashboard (Settings), not in code:
//   - An R2 bucket bound to this project as MAPFAM_BUCKET
//     (Settings -> Functions -> R2 bucket bindings)
//   - An environment variable MAPFAM_PUBLIC_BASE_URL — the bucket's public
//     URL (Settings -> Environment variables)
//   - Optionally, a secret UPLOAD_TOKEN if you want to gate uploads/deletes
//
// Storage layout in the bucket:
//   mapfam/manifest.json     <- list of every uploaded image: [{id, url}]
//   mapfam/{id}.{ext}        <- the actual image files
//
// API:
//   GET    /api/mapfam            -> { images: [{id, url}] }
//   POST   /api/mapfam (file=...) -> uploads, returns updated { images }
//   DELETE /api/mapfam?id=X       -> removes, returns updated { images }

const MANIFEST_KEY = 'mapfam/manifest.json';
const MAX_BYTES = 8 * 1024 * 1024; // 8MB

function json(data, status){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    // Cache-Control: no-store matters here — without it, Cloudflare's edge
    // can cache an early "empty manifest" response and keep serving that
    // stale result on refresh even after real uploads succeed. (This bit
    // Easy Tarkov's identical image API early on — baking the fix in here
    // from the start.)
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function readManifest(bucket){
  const obj = await bucket.get(MANIFEST_KEY);
  if(!obj) return [];
  try{
    return await obj.json();
  }catch(e){
    return [];
  }
}

async function writeManifest(bucket, images){
  await bucket.put(MANIFEST_KEY, JSON.stringify(images), {
    httpMetadata: { contentType: 'application/json' }
  });
}

function checkToken(request, env){
  if(!env.UPLOAD_TOKEN) return true; // no token configured, skip check
  return request.headers.get('X-Upload-Token') === env.UPLOAD_TOKEN;
}

// ---- GET: anyone can read the current shared image list ----
export async function onRequestGet(context){
  const images = await readManifest(context.env.MAPFAM_BUCKET);
  return json({ images });
}

// ---- POST: upload a new image (requires token if one is set) ----
export async function onRequestPost(context){
  const { request, env } = context;

  if(!checkToken(request, env)){
    return json({ error: 'Unauthorized' }, 401);
  }

  let form;
  try{
    form = await request.formData();
  }catch(e){
    return json({ error: 'Expected multipart/form-data' }, 400);
  }

  const file = form.get('file');
  if(!file || typeof file === 'string'){
    return json({ error: 'Missing "file" field' }, 400);
  }
  if(file.size > MAX_BYTES){
    return json({ error: 'File too large' }, 413);
  }
  if(!file.type || !file.type.startsWith('image/')){
    return json({ error: 'Only image uploads are accepted' }, 415);
  }

  const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop() : 'jpg';
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  const key = 'mapfam/' + id + '.' + ext;

  await env.MAPFAM_BUCKET.put(key, file.stream(), {
    httpMetadata: { contentType: file.type }
  });

  const url = env.MAPFAM_PUBLIC_BASE_URL + '/' + key;
  const images = await readManifest(env.MAPFAM_BUCKET);
  images.push({ id: id, url: url });
  await writeManifest(env.MAPFAM_BUCKET, images);

  return json({ images });
}

// ---- DELETE: remove an image (requires token if one is set) ----
export async function onRequestDelete(context){
  const { request, env } = context;

  if(!checkToken(request, env)){
    return json({ error: 'Unauthorized' }, 401);
  }

  const id = new URL(request.url).searchParams.get('id');
  if(!id){
    return json({ error: 'Missing id query param' }, 400);
  }

  const images = await readManifest(env.MAPFAM_BUCKET);
  const target = images.find(img => img.id === id);
  const remaining = images.filter(img => img.id !== id);

  if(target){
    const key = target.url.replace(env.MAPFAM_PUBLIC_BASE_URL + '/', '');
    await env.MAPFAM_BUCKET.delete(key);
  }
  await writeManifest(env.MAPFAM_BUCKET, remaining);

  return json({ images: remaining });
}
