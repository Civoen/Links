// ============================================================
// MAPFAM UPLOAD CONFIG
// ============================================================
// By default this is false. In that state, images are stored directly in
// THIS browser's localStorage (as base64) — the page works immediately
// with no setup, but images are 100% private to this one browser. Nobody
// else visiting the site sees them, and there's no way around that without
// a server: a static site has nowhere shared to keep a list of images.
//
// To make uploads visible to every visitor, this site's Pages Function (see
// functions/api/mapfam.js) already handles an /api/mapfam route that stores
// images in R2 and keeps a shared manifest of what's been uploaded — you
// just need to point Cloudflare at a real R2 bucket for it (see the setup
// guide: create the bucket, add the binding, add the public URL variable,
// all done by clicking through the Cloudflare dashboard, no terminal
// needed). Once that's done, flip this to true. From then on:
//   - On page load, every visitor's browser fetches the current image list
//     from /api/mapfam instead of reading its own localStorage.
//   - Uploads POST to /api/mapfam, which stores the file in R2, updates
//     the shared list, and every visitor sees the new image on their next
//     page load.
const MAPFAM_SHARED_MODE = true;
const MAPFAM_UPLOAD_ENDPOINT = '/api/mapfam'; // same-origin, no CORS setup needed

// If you set an UPLOAD_TOKEN variable on the Pages project (see setup guide), put
// the same value here so uploads/removals are authorized. Leave blank if
// you haven't set one up.
const MAPFAM_UPLOAD_TOKEN = '';

// ============================================================
// MAPFAM EDIT LOCK
// ============================================================
// This only gates the "Add Image" / remove controls in THIS browser's UI —
// it does not restrict who can view images, and (like everything static)
// it's not real security since the passphrase lives in this file's plain
// text source. Change it to whatever you like before deploying.
const MAPFAM_EDIT_PASSPHRASE = 'boost';
const MAPFAM_UNLOCK_KEY = 'mw4camo-mapfam-unlocked';

const MAPFAM_IMAGES_KEY = 'mw4camo-mapfam-images'; // local-only fallback storage

function loadLocalMapfamImages(){
  try{
    const raw = localStorage.getItem(MAPFAM_IMAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){
    return [];
  }
}
function saveLocalMapfamImages(images){
  try{
    localStorage.setItem(MAPFAM_IMAGES_KEY, JSON.stringify(images));
    return true;
  }catch(e){
    return false; // most likely a quota error from storing base64 images locally
  }
}

function isMapfamUnlocked(){
  try{ return localStorage.getItem(MAPFAM_UNLOCK_KEY) === '1'; }catch(e){ return false; }
}

function mapfamAuthHeaders(){
  return MAPFAM_UPLOAD_TOKEN ? { 'X-Upload-Token': MAPFAM_UPLOAD_TOKEN } : {};
}

function initMapfam(config){
  const gridEl = document.getElementById(config.gridElId);
  const addImageBtn = document.getElementById(config.addImageBtnId);
  const lockToggleBtn = document.getElementById(config.lockToggleBtnId);
  const shared = MAPFAM_SHARED_MODE;
  let images = shared ? [] : loadLocalMapfamImages(); // {id, url|src}
  let unlocked = isMapfamUnlocked();

  // Hidden file input, reused for every upload.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  // Zoom overlay, reused for every image.
  const zoomOverlay = document.createElement('div');
  zoomOverlay.className = 'mapfam-zoom-overlay';
  zoomOverlay.innerHTML = '<img alt="Full size image">';
  document.body.appendChild(zoomOverlay);
  const zoomImg = zoomOverlay.querySelector('img');
  zoomOverlay.addEventListener('click', () => {
    zoomOverlay.classList.remove('open');
    zoomImg.src = '';
  });

  function imgSrc(img){ return img.url || img.src; }

  function updateLockUI(){
    if(!lockToggleBtn) return;
    lockToggleBtn.textContent = unlocked ? 'Lock Editing' : 'Unlock Editing';
    if(addImageBtn) addImageBtn.style.display = unlocked ? '' : 'none';
  }

  function render(){
    gridEl.innerHTML = images.length
      ? images.map(img => renderItem(img)).join('')
      : '<div class="empty-note">No images yet.' + (unlocked ? ' Click "Add Image" to start.' : '') + '</div>';
    updateLockUI();
    bindEvents();
  }

  function renderItem(img){
    return '<div class="mapfam-box" data-id="'+img.id+'">' +
      '<div class="card-inner" data-id="'+img.id+'">' +
        '<img src="'+imgSrc(img)+'" alt="Uploaded map image" loading="lazy">' +
        (unlocked ? '<button class="mapfam-box-remove" data-id="'+img.id+'" type="button" aria-label="Remove image">&times;</button>' : '') +
      '</div>' +
    '</div>';
  }

  function bindEvents(){
    gridEl.querySelectorAll('.mapfam-box-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeImage(btn.getAttribute('data-id'));
      });
    });
    gridEl.querySelectorAll('.mapfam-box .card-inner').forEach(box => {
      box.addEventListener('click', () => {
        const id = box.getAttribute('data-id');
        const img = images.find(i => i.id === id);
        if(img){
          zoomImg.src = imgSrc(img);
          zoomOverlay.classList.add('open');
        }
      });
    });
  }

  function removeImage(id){
    const idx = images.findIndex(i => i.id === id);
    if(idx === -1) return;
    const removed = images[idx];
    images = images.slice(0, idx).concat(images.slice(idx + 1)); // optimistic
    render();

    showUndoToast(
      'Removed image',
      () => {
        // Commit: only now does the file actually get deleted (from R2 in
        // shared mode, or from localStorage in local mode).
        if(shared){
          fetch(MAPFAM_UPLOAD_ENDPOINT + '?id=' + encodeURIComponent(id), {
            method: 'DELETE',
            headers: mapfamAuthHeaders()
          })
            .then(r => r.json())
            .then(data => { images = data.images || images; render(); })
            .catch(err => {
              console.error('Mapfam remove failed:', err);
              alert('Could not remove that image from the server. Try again.');
            });
        }else{
          saveLocalMapfamImages(images);
        }
      },
      () => {
        // Undo: nothing was ever actually deleted, just put it back visually.
        images = images.slice(0, idx).concat([removed], images.slice(idx));
        render();
      }
    );
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    fileInput.value = '';
    if(!file || !unlocked) return;

    if(shared){
      const formData = new FormData();
      formData.append('file', file);
      fetch(MAPFAM_UPLOAD_ENDPOINT, { method: 'POST', body: formData, headers: mapfamAuthHeaders() })
        .then(r => r.json())
        .then(data => {
          if(!data || !data.images) throw new Error('Unexpected response');
          images = data.images;
          render();
        })
        .catch(err => {
          console.error('Mapfam upload failed:', err);
          alert('Upload failed. Check that the R2 bucket binding and MAPFAM_PUBLIC_BASE_URL variable are set on this Pages project in the Cloudflare dashboard, then try again.');
        });
    }else{
      const reader = new FileReader();
      reader.onload = (ev) => {
        images.push({ id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), src: ev.target.result });
        const ok = saveLocalMapfamImages(images);
        if(!ok){
          alert('This browser\'s local storage is full. Remove some images, or set up the Pages Function (see the comment at the top of mapfam.js) so images are shared and hosted on R2 instead.');
          images.pop();
        }
        render();
      };
      reader.readAsDataURL(file);
    }
  });

  if(addImageBtn){
    addImageBtn.addEventListener('click', () => {
      if(!unlocked) return;
      fileInput.click();
    });
  }

  if(lockToggleBtn){
    lockToggleBtn.addEventListener('click', () => {
      if(unlocked){
        unlocked = false;
        try{ localStorage.removeItem(MAPFAM_UNLOCK_KEY); }catch(e){}
        render();
        return;
      }
      const attempt = prompt('Enter the passphrase to edit this page:');
      if(attempt === null) return; // cancelled
      if(attempt === MAPFAM_EDIT_PASSPHRASE){
        unlocked = true;
        try{ localStorage.setItem(MAPFAM_UNLOCK_KEY, '1'); }catch(e){}
        render();
      }else{
        alert('Incorrect passphrase.');
      }
    });
  }

  if(shared){
    gridEl.innerHTML = '<div class="empty-note">Loading images&hellip;</div>';
    fetch(MAPFAM_UPLOAD_ENDPOINT)
      .then(r => r.json())
      .then(data => {
        images = (data && data.images) || [];
        render();
      })
      .catch(err => {
        console.error('Mapfam load failed:', err);
        gridEl.innerHTML = '<div class="empty-note">Could not load images from the server. Check the R2 bucket binding on this Pages project in the Cloudflare dashboard.</div>';
        updateLockUI();
      });
  }else{
    render();
  }
}
