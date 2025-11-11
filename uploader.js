'use strict';
(function initLandingVault(document, window){
  const App = window.NostrApp || (window.NostrApp = {});
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const selectButton = document.getElementById('selectButton');
  const statusBox = document.getElementById('statusBox');
  const statusMessage = document.getElementById('statusMessage');
  const resultPanel = document.getElementById('resultPanel');
  const copyButton = document.getElementById('copyButton');
  const previewContainer = document.getElementById('resultPreview');
  const progressBar = document.getElementById('progressBar');
  const progressValue = document.getElementById('progressValue');
  const backButton = document.getElementById('backButton');
  const body = document.body;
  const availabilityStatus = document.getElementById('availabilityStatus');

  async function checkAvailability(){
    if(availabilityStatus){
      availabilityStatus.textContent = '';
      availabilityStatus.hidden = true;
    }
  }

  function updateStatus(msg, isError, keepProgress){
    if(statusMessage){
      statusMessage.textContent = msg;
      statusMessage.style.color = isError ? '#ff8f8f' : 'var(--text-muted)';
    }
    if(statusBox){
      statusBox.style.color = isError ? '#ff8f8f' : 'var(--text-muted)';
    }
    if(!keepProgress && progressValue){
      progressValue.hidden = true;
      progressValue.textContent = '0%';
    }
  }

  function resetResult(){
    resultPanel.hidden = true;
    delete copyButton.dataset.href;
    copyButton.textContent = 'העתיקו לינק';
    previewContainer.innerHTML = '';
    progressBar.hidden = true;
    progressBar.removeAttribute('value');
    if(progressValue){
      progressValue.hidden = true;
      progressValue.textContent = '0%';
    }
    body.classList.remove('result-open');
  }

  async function compressVideo(file){
    if(!file.type.startsWith('video/')){
      throw new Error('not-video');
    }

    if(file.size > 30 * 1024 * 1024){
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`big-file:${sizeMB}`);
    }

    updateStatus('טוען וידאו לדחיסה...', false);

    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.crossOrigin = 'anonymous';

    await new Promise((resolve, reject)=>{
      video.onloadedmetadata = resolve;
      video.onerror = ()=> reject(new Error('load-failed'));
      setTimeout(()=> reject(new Error('load-timeout')), 10000);
    });

    const stream = typeof video.captureStream === 'function' ? video.captureStream() : video.mozCaptureStream?.();
    if(!stream){
      URL.revokeObjectURL(video.src);
      throw new Error('stream-missing');
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1_000_000,
      audioBitsPerSecond: 96_000,
    });

    recorder.ondataavailable = (event)=>{
      if(event.data?.size) chunks.push(event.data);
    };

    const duration = video.duration || 1;
    const interval = setInterval(()=>{
      const percent = Math.min(90, Math.round((video.currentTime / duration) * 80) + 10);
      updateStatus(`דוחס וידאו... ${percent}%`, false);
    }, 400);

    const completion = new Promise((resolve)=>{
      recorder.onstop = resolve;
    });

    recorder.start(100);
    await video.play();

    await new Promise((resolve)=>{
      video.onended = ()=>{
        clearInterval(interval);
        recorder.stop();
        resolve();
      };
    });

    await completion;
    URL.revokeObjectURL(video.src);

    updateStatus('מסיים דחיסה...', false);

    const blob = new Blob(chunks, { type: mimeType });
    return blob;
  }

  async function uploadBinary(blob, originalName, onProgress){
    const fd = new FormData();
    fd.append('file', blob, originalName || 'video.webm');
    const endpoint = 'https://void.cat/upload';
    const xhr = new XMLHttpRequest();
    const result = await new Promise((resolve, reject)=>{
      xhr.upload.onprogress = (event)=>{
        if(typeof onProgress === 'function'){
          const totalBytes = (event.total && event.total > 0) ? event.total : (blob?.size || event.loaded || 1);
          const loadedBytes = event.loaded ?? 0;
          onProgress(loadedBytes, totalBytes, false);
        }
      };
      xhr.onreadystatechange = ()=>{
        if(xhr.readyState === 4){
          if(xhr.status >= 200 && xhr.status < 300){
            resolve(xhr.responseText);
          }else{
            reject(new Error('upload-failed'));
          }
        }
      };
      xhr.onerror = ()=> reject(new Error('upload-failed'));
      xhr.open('POST', endpoint, true);
      xhr.send(fd);
    });
    let data = null;
    try{ data = JSON.parse(result); }catch{}
    const url = data?.file?.url || data?.url;
    if(!url) throw new Error('no-url');
    return url;
  }

  async function uploadViaAppIfAvailable(blob, mimeType, onProgress){
    let syntheticTimer = null;
    let syntheticValue = 0;

    try{
      const app = window.NostrApp || {};
      if(typeof app.ensureKeys === 'function'){
        try{ app.ensureKeys(); }catch(e){}
      }
      if(typeof app.uploadToBlossom === 'function'){
        if(typeof onProgress === 'function'){
          syntheticValue = 0;
          syntheticTimer = setInterval(()=>{
            syntheticValue = Math.min(98, syntheticValue + 4);
            onProgress(syntheticValue, 100, true);
          }, 450);
        }
        const url = await app.uploadToBlossom(blob, null, mimeType);
        if(syntheticTimer){
          clearInterval(syntheticTimer);
          syntheticTimer = null;
        }
        if(url && typeof onProgress === 'function'){
          onProgress(100, 100, true);
        }
        if(url && typeof url === 'string') return url;
        if(url && url.url) return url.url;
      }
    }catch(e){
      console.warn('app upload failed', e);
    }finally{
      if(syntheticTimer){
        clearInterval(syntheticTimer);
      }
    }
    return null;
  }

  function presentResult(file, url, label){
    previewContainer.innerHTML = '';

    if(file.type.startsWith('video/')){
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative';
      wrapper.style.display = 'inline-block';
      const video = document.createElement('video');
      video.src = url;
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.style.width = '100%';
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = '▶';
      play.style.position = 'absolute';
      play.style.inset = '0';
      play.style.margin = 'auto';
      play.style.width = '72px';
      play.style.height = '72px';
      play.style.borderRadius = '50%';
      play.style.border = 'none';
      play.style.background = 'rgba(0,0,0,0.6)';
      play.style.color = '#fff';
      play.style.fontSize = '32px';
      play.style.cursor = 'pointer';
      play.addEventListener('click', ()=>{
        play.remove();
        video.play().catch(()=>{});
      });
      wrapper.appendChild(video);
      wrapper.appendChild(play);
      previewContainer.appendChild(wrapper);
    }else if(file.type.startsWith('audio/')){
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      audio.style.width = '100%';
      previewContainer.appendChild(audio);
    }else if(file.type.startsWith('image/')){
      const img = document.createElement('img');
      img.src = url;
      img.alt = label;
      img.style.maxWidth = '100%';
      img.style.display = 'block';
      previewContainer.appendChild(img);
    }

    copyButton.dataset.href = url;
    resultPanel.hidden = false;
    body.classList.add('result-open');
  }

  async function processFiles(fileList){
    const file = fileList?.length ? fileList[0] : null;
    if(!file){
      updateStatus('לא נבחר וידאו.', true);
      return;
    }

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');

    if(!isVideo && !isImage && !isAudio){
      updateStatus('הקובץ שנבחר אינו וידאו, אודיו או תמונה נתמכים.', true);
      return;
    }

    resetResult();

    try{
      let blob = file;
      let typeLabel = 'מדיה';

      if(isVideo){
        blob = await compressVideo(file);
        typeLabel = 'וידאו';
        updateStatus('מעלה וידאו...', false);
        progressBar.hidden = false;
        progressBar.removeAttribute('value');
        if(progressValue){
          progressValue.hidden = false;
          progressValue.textContent = '0%';
        }
      }else if(isAudio){
        typeLabel = 'אודיו';
        updateStatus('מעלה אודיו...', false);
        progressBar.hidden = false;
        progressBar.removeAttribute('value');
        if(progressValue){
          progressValue.hidden = false;
          progressValue.textContent = '0%';
        }
      }else{
        typeLabel = 'תמונה';
        updateStatus('מעלה תמונה...', false);
        progressBar.hidden = false;
        progressBar.removeAttribute('value');
        if(progressValue){
          progressValue.hidden = false;
          progressValue.textContent = '0%';
        }
      }

      const totalBytes = blob.size || file.size || 1;

      const updateProgressDisplay = (loaded, total, synthetic)=>{
        let percent;
        if(synthetic){
          percent = Math.max(0, Math.min(100, Math.round(loaded)));
        }else{
          const totalForCalc = (total && total > 0) ? total : totalBytes;
          const loadedForCalc = loaded ?? 0;
          percent = Math.max(0, Math.min(100, Math.round((loadedForCalc / totalForCalc) * 100)));
        }
        progressBar.hidden = false;
        progressBar.max = 100;
        progressBar.value = percent;
        if(progressValue){
          progressValue.hidden = false;
          progressValue.textContent = `${percent}%`;
        }
        if(synthetic){
          updateStatus(`מעלה ${typeLabel} דרך אפליקציה...`, false, true);
        }else if(percent >= 97){
          updateStatus('מסיים יצירת הקישור...', false, true);
        }else{
          updateStatus(`מעלה ${typeLabel}...`, false, true);
        }
      };

      updateProgressDisplay(0, totalBytes, false);

      let url = await uploadViaAppIfAvailable(blob, file.type, updateProgressDisplay);
      if(!url){
        const fallbackName = isVideo ? 'video.webm' : isAudio ? 'audio.webm' : 'image';
        url = await uploadBinary(blob, file.name || fallbackName, updateProgressDisplay);
      }

      updateProgressDisplay(totalBytes, totalBytes, false);

      presentResult(file, url, file.name || typeLabel);
      if(typeLabel === 'וידאו'){
        updateStatus('וידיאו עלה בהצלחה.', false);
      }else{
        updateStatus(`${typeLabel} עלה בהצלחה.`, false);
      }
      setTimeout(()=>{
        progressBar.hidden = true;
        progressBar.removeAttribute('value');
        if(progressValue){
          progressValue.hidden = true;
          progressValue.textContent = '0%';
        }
      }, 600);
    }catch(err){
      console.error('video upload failed', err);
      progressBar.hidden = true;
      progressBar.removeAttribute('value');
      if(progressValue){
        progressValue.hidden = true;
        progressValue.textContent = '0%';
      }
      if(err?.message?.startsWith('big-file')){
        const size = err.message.split(':')[1] || '';
        updateStatus(`הקובץ גדול מדי (${size}MB). הגבול הוא 30MB.`, true);
      }else if(err?.message === 'load-failed' || err?.message === 'load-timeout'){
        updateStatus('טעינת הווידאו נכשלה. בדקו שהקובץ תקין.', true);
      }else if(err?.message === 'stream-missing'){
        updateStatus('הדפדפן לא תומך בדחיסה. נסו דפדפן אחר.', true);
      }else if(err?.message === 'upload-failed'){
        updateStatus('העלאה נכשלה. נסו מאוחר יותר.', true);
      }else if(err?.message === 'no-url'){
        updateStatus('השרת לא החזיר כתובת. בדקו את הקובץ ונסו שוב.', true);
      }else{
        updateStatus('אירעה שגיאה. נסו קובץ אחר או רעננו את העמוד.', true);
      }
    }
  }

  function preventDefaults(e){ e.preventDefault(); e.stopPropagation(); }

  dropZone.addEventListener('dragenter', (e)=>{ preventDefaults(e); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragover', (e)=>{ preventDefaults(e); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', (e)=>{ preventDefaults(e); dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', (e)=>{
    preventDefaults(e);
    dropZone.classList.remove('dragover');
    if(!e.dataTransfer?.files?.length) return;
    processFiles(e.dataTransfer.files);
  });

  dropZone.addEventListener('click', ()=> fileInput.click());
  selectButton.addEventListener('click', ()=> fileInput.click());
  fileInput.addEventListener('change', ()=>{
    if(fileInput.files?.length) processFiles(fileInput.files);
    fileInput.value = '';
  });

  copyButton.addEventListener('click', async ()=>{
    const url = copyButton.dataset.href;
    if(!url) return;
    try{
      await navigator.clipboard.writeText(url);
      copyButton.textContent = 'הועתק';
      setTimeout(()=>{ copyButton.textContent = 'העתיקו לינק'; }, 2000);
    }catch{
      copyButton.textContent = 'שגיאת העתקה';
    }
  });

  backButton?.addEventListener('click', ()=>{
    resetResult();
    updateStatus('בחרו קובץ חדש להעלאה.', false);
  });

  checkAvailability();

  })(document, window);

document.addEventListener('DOMContentLoaded', () => {
  const menuItems = document.querySelectorAll('.menu__item, .bottom-menu__item, .footer__link[data-modal]');
  const modals = document.querySelectorAll('.modal');
  const closeButtons = document.querySelectorAll('.modal__close');
  const backdrops = document.querySelectorAll('.modal__backdrop');
  const bottomToggle = document.getElementById('bottomToggle');
  const bottomMenu = document.getElementById('bottomMenu');
  const audioToggle = document.getElementById('musicToggle');
  const bgAudio = document.getElementById('bgAudio');
  const cornerLights = document.querySelector('.corner-lights');
  const dropPanelMain = document.querySelector('.drop__panel');

  if(bgAudio){
    bgAudio.volume = 0.4;
  }

  const setAudioVisualState = (isActive)=>{
    if(cornerLights){
      cornerLights.classList.toggle('active', !!isActive);
    }
    if(dropPanelMain){
      dropPanelMain.classList.toggle('glow', !!isActive);
    }
    if(audioToggle){
      audioToggle.classList.toggle('music-toggle--active', !!isActive);
      audioToggle.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      audioToggle.textContent = isActive ? '⏸ עצור נגינה' : '🎵 נגינת רקע';
    }
  };

  if(bgAudio){
    bgAudio.addEventListener('play', ()=> setAudioVisualState(true));
    bgAudio.addEventListener('pause', ()=> setAudioVisualState(false));
    bgAudio.addEventListener('ended', ()=> setAudioVisualState(false));
  }

  menuItems.forEach(button => {
    button.addEventListener('click', () => {
      const modalId = `${button.dataset.modal}Modal`;
      const modal = document.getElementById(modalId);
      if(!modal) return;
      modal.hidden = false;
      modal.style.display = 'flex';
      modal.querySelector('.modal__content').style.transform = 'scale(1)';
    });
  });

  closeButtons.forEach(button => {
    button.addEventListener('click', () => {
      const modalId = `${button.dataset.modal}Modal`;
      const modal = document.getElementById(modalId);
      if(!modal) return;
      modal.hidden = true;
      modal.style.display = 'none';
    });
  });

  backdrops.forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      const modalId = `${backdrop.dataset.modal}Modal`;
      const modal = document.getElementById(modalId);
      if(!modal) return;
      modal.hidden = true;
      modal.style.display = 'none';
    });
  });

  if(bottomToggle && bottomMenu){
    bottomToggle.addEventListener('click', () => {
      const isOpen = bottomMenu.classList.contains('open');
      const toggleIcon = bottomToggle.querySelector('.toggle-icon');
      if(isOpen){
        bottomMenu.classList.remove('open');
        bottomToggle.classList.remove('active');
        if(toggleIcon) toggleIcon.textContent = '▲';
      }else{
        bottomMenu.classList.add('open');
        bottomToggle.classList.add('active');
        if(toggleIcon) toggleIcon.textContent = '✕';
      }
    });
  }

  if(audioToggle && bgAudio){
    audioToggle.addEventListener('click', async ()=>{
      try{
        if(bgAudio.paused){
          await bgAudio.play();
        }else{
          bgAudio.pause();
        }
      }catch(err){
        console.warn('audio-toggle-failed', err);
      }
    });
  }else if(audioToggle){
    // במידה ואין אודיו נטען, ודא שהכפתור מסמן מצב כבוי
    setAudioVisualState(false);
  }
});
