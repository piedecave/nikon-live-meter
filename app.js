'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const APERTURES=[4,4.5,5,5.6,6.3,7.1,8,9,10,11,13,14,16,18,20,22];
  const ISO=[100,125,160,200,250,320,400,500,640,800,1000,1250,1600,2000,2500,3200,4000,5000,6400,8000,10000,12800,16000,20000,25600,32000,40000,51200];
  const TIMES=[30,25,20,15,13,10,8,6,5,4,3.2,2.5,2,1.6,1.3,1,0.8,0.625,0.5,0.4,1/3,1/4,1/5,1/6,1/8,1/10,1/13,1/15,1/20,1/25,1/30,1/40,1/50,1/60,1/80,1/100,1/125,1/160,1/200,1/250,1/320,1/400,1/500,1/640,1/800,1/1000,1/1250,1/1600,1/2000,1/2500,1/3200,1/4000,1/5000,1/6400,1/8000,1/10000,1/12500,1/16000];
  const PRESETS={
    travel:{f:5.6,iso:200,scene:12,target:250,cap:12800,advice:'Reportage: usa AF-C, verifica il tempo per persone che camminano e prediligi 24–70 mm per il contesto.'},
    landscape:{f:8,iso:100,scene:13,target:125,cap:3200,advice:'Paesaggio: f/8 e ISO bassi; controlla orizzonte e bordi, usa un treppiede se il tempo diventa lungo.'},
    architecture:{f:8,iso:100,scene:12,target:125,cap:3200,advice:'Architettura: f/8, 24–35 mm, fotocamera in bolla per evitare verticali convergenti.'},
    portrait:{f:4,iso:200,scene:13,target:250,cap:6400,advice:'Ritratto: a 85–120 mm e f/4, usa rilevamento occhi/persona e verifica la nitidezza dell’occhio.'},
    basket:{f:4,iso:3200,scene:7,target:800,cap:25600,advice:'Basket indoor: M, f/4, AF-C, rilevamento persone e raffiche brevi; prova 1/800–1/1000 s. ISO alti possono essere necessari.'},
    night:{f:8,iso:100,scene:4,target:0,cap:100,advice:'Notte statica: treppiede, ISO 100, autoscatto e AF-S/MF. Controlla le luci bruciate.'}
  };
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const fmtF=x=>'f/'+String(x).replace('.',',');
  const fmtTime=t=> t>=1?Number(t.toFixed(2)).toLocaleString('it-IT')+' s':'1/'+Math.round(1/t)+' s';
  const closest=(values,x)=>values.reduce((best,v)=>Math.abs(Math.log(v/x))<Math.abs(Math.log(best/x))?v:best,values[0]);
  function fill(id,items,selected,label){const el=$(id);for(const item of items)el.add(new Option(label?label(item):String(item),String(item)));el.value=String(selected);}
  fill('aperture',APERTURES,5.6,fmtF);fill('iso',ISO,200,x=>'ISO '+x);fill('iso-max',ISO,12800,x=>String(x));
  fill('cal-time',TIMES,1/125,fmtTime);fill('cal-f',APERTURES,8,fmtF);fill('cal-iso',ISO,100,x=>String(x));
  fill('wizard-time',TIMES,1/125,fmtTime);fill('wizard-f',APERTURES,8,fmtF);fill('wizard-iso',ISO,100,x=>String(x));
  let stream=null, loop=null, facing='environment', last=null,calibration=null,lastOut=null;
  let frozen=false, spotTap=false, spot={x:0.5,y:0.5};
  let meterHistory=[];
  let spotReference=null; // riferimento tonale precedente per confrontare due punti
  let calibrations={};
  const CAL_KEY='nikon-live-calibration-v6-cameras';
  const GUIDED_KEY='nikon-live-v72-guided-samples';
  const STAGES=['bright','mid','dim'];
  const STAGE_LABEL={bright:'Luminosa',mid:'Intermedia',dim:'Poco illuminata'};
  let guidedSamples={};
  try{const previous=JSON.parse(localStorage.getItem(GUIDED_KEY)||'{}');if(previous&&typeof previous==='object'&&!Array.isArray(previous))guidedSamples=previous;}catch(e){}
  let selectedCameraId='',cameraBusy=false;
  // La prima lettura video fissa SOLO un riferimento tonale relativo.
  let zoom=1;
  const zoomSlider=$('zoom-range');
  const zoomButtons=[...document.querySelectorAll('[data-zoom]')];
  function updateZoom(zoomValue){
    zoom=clamp(Number(zoomValue)||1,1,4);
    zoomSlider.value=String(zoom);
    $('zoom-value').textContent=zoom.toLocaleString('it-IT',{maximumFractionDigits:1})+'×';
    $('camera').style.transform='scale('+zoom+')';
    zoomButtons.forEach(button=>button.classList.toggle('selected',Math.abs(Number(button.dataset.zoom)-zoom)<0.051));
    // Cambiando campo visivo, la luminanza varia: azzera il riferimento relativo.
    baseline=null;
    last=null;
    loadCameraCalibration();
    recalculate();
    if(stream){positionSpotMarker();analyze();}
  }
  zoomSlider.addEventListener('input',()=>updateZoom(zoomSlider.value));
  zoomButtons.forEach(button=>button.addEventListener('click',()=>updateZoom(button.dataset.zoom)));
  function zoomAvailable(active){zoomSlider.disabled=!active;zoomButtons.forEach(button=>button.disabled=!active);}
  let baseline=null, frameCount=0;
  let context=null,canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;
  context=canvas.getContext('2d',{willReadFrequently:true});
  const graph=$('histogram').getContext('2d');
  try {
    const saved=JSON.parse(localStorage.getItem(CAL_KEY)||'{}');
    if(saved && typeof saved==='object' && !Array.isArray(saved)) calibrations=saved;
  } catch(e) {}
  function cameraKey(){
    return selectedCameraId || stream?.getVideoTracks()[0]?.getSettings()?.deviceId || 'default-'+facing;
  }
  function saveCalibrations(){
    try{localStorage.setItem(CAL_KEY,JSON.stringify(calibrations));return true;}catch(e){return false;}
  }
  function guidedKey(){return calibrationKey();}
  function guidedCurrent(){return guidedSamples[guidedKey()]||{};}
  function saveGuided(){try{localStorage.setItem(GUIDED_KEY,JSON.stringify(guidedSamples));return true;}catch(e){return false;}}
  function renderGuided(){
    const data=guidedCurrent(),done=STAGES.filter(x=>data[x]).length;
    $('wizard-progress').textContent=done+'/3';
    $('wizard-samples').replaceChildren();
    for(const stage of STAGES){
      const record=data[stage],row=document.createElement('div');row.className='sample-item';
      const label=document.createElement('strong');label.textContent=STAGE_LABEL[stage];row.append(label);
      const value=document.createElement('span');
      value.textContent=record?'EV '+record.ev.toFixed(2)+' · mediana '+Math.round(record.median*100)+'%':'Da registrare';
      row.append(value);$('wizard-samples').append(row);
    }
    if(!stream){$('wizard-info').textContent='Avvia la fotocamera per registrare una lettura.';return;}
    if(frozen){$('wizard-info').textContent='Sblocca la lettura prima di registrare.';return;}
    if(!last){$('wizard-info').textContent='Attendi i primi fotogrammi video.';return;}
    const variation=meterHistory.length>4?Math.max(...meterHistory)-Math.min(...meterHistory):Infinity;
    const stability=variation<.055?'Scena tonale stabile':'Luce o autoesposizione variabile';
    $('wizard-info').textContent=stability+' · '+done+' su 3 scene registrate. Confronta i valori Nikon e verifica l’istogramma.';
  }
  function guidedReference(){
    const saved=guidedCurrent();const candidates=STAGES.map(k=>saved[k]).filter(Boolean);
    if(!candidates.length || !last)return null;
    const winner=candidates.reduce((a,b)=>Math.abs(a.median-last.median)<=Math.abs(b.median-last.median)?a:b);
    return {sample:winner,count:candidates.length,distance:Math.abs(winner.median-last.median)};
  }
  function calibrationMatches(){
    if(!calibration) return false;
    if(calibration.metering!==$('metering').value || Math.abs((calibration.zoom||1)-zoom)>.051) return false;
    if(calibration.metering==='spot' && Math.hypot(calibration.spotX-spot.x,calibration.spotY-spot.y)>.012) return false;
    return true;
  }
  function calibrationKey(){return cameraKey()+'|'+$('metering').value+'|z'+zoom.toFixed(1)+'|'+($('metering').value==='spot'?(Math.round(spot.x*100)+'_'+Math.round(spot.y*100)):'all');}
  function loadCameraCalibration(){
    const item=calibrations[calibrationKey()] || calibrations[cameraKey()];
    calibration=item && Number.isFinite(item.ev) && item.ev>-15 && item.ev<25 ? item : null;
    showCalibration();
    renderGuided();
    recalculate();
  }
  function showCalibration(){
    const cameraName=stream?.getVideoTracks()[0]?.label || (stream?'Fotocamera selezionata':'Avvia una fotocamera');
    $('calibration-camera').textContent='Fotocamera di calibrazione: '+cameraName;
    if(!calibration){
      $('calibration-status').textContent='Nessuna calibrazione salvata per questa fotocamera: si utilizza l’EV della scena.';
    } else if(!calibrationMatches()){
      $('calibration-status').textContent='Calibrazione salvata (EV '+calibration.ev.toFixed(2)+'), ma zoom, zona di misura o punto spot sono cambiati. Ritorna alle impostazioni originarie o ricalibra: ora è usato l’EV della scena.';
    } else {
      $('calibration-status').textContent='Calibrazione attiva per questa fotocamera: EV100 '+calibration.ev.toFixed(2)+(calibration.median!=null?' · mediana '+Math.round(calibration.median*100)+'%':'')+'. La correzione live resta sperimentale.';
    }
  }
  function applyPreset(name){const p=PRESETS[name];$('aperture').value=String(p.f);$('iso').value=String(p.iso);$('scene').value=String(p.scene);$('target').value=String(p.target);$('iso-max').value=String(p.cap);recalculate();}
  function targetEV(){
    const scene=Number($('scene').value);
    const matched=calibrationMatches();
    const guided=guidedReference();
    const anchor=guided?guided.sample.ev:(matched?calibration.ev:scene);
    const reference=guided?guided.sample.median:(matched&&calibration.median!=null?calibration.median:baseline);
    let d=0;
    if(last && reference!=null && $('tone-correction').checked){
      // Rapporto tra luminanze VIDEO sRGB: non equivale a stop di luce misurati.
      // Con riferimento Nikon limitiamo la variazione per evitare correzioni arbitrarie.
      d=clamp(0.70*Math.log2((last.median+0.03)/(reference+0.03)),guided||matched?-1: -2,guided||matched?1:2);
    }
    const desc=guided?'Riferimento Nikon guidato ('+guided.count+'/3)':matched?'EV Nikon singolo':'EV scena presunto';
    return {ev:anchor+d,description:desc+(last&&$('tone-correction').checked?' + variazione tonale indicativa':''),delta:d,guided};
  }
  // EV100 = log2(N²/t) - log2(ISO/100). A positive comp means more exposure.
  const exposureSeconds=(ev,f,iso,comp)=>f*f*100/iso*Math.pow(2,comp-ev);
  function recalculate(){
    if(frozen) return;
    const {ev,description,delta,guided}=targetEV();const f=Number($('aperture').value),initialIso=Number($('iso').value),comp=Number($('comp').value),maxIso=Number($('iso-max').value),den=Number($('target').value);const minTime=den?1/den:0;
    // Choose the lowest available ISO at or above initial ISO that reaches the requested minimum shutter time.
    const candidates=ISO.filter(x=>x>=initialIso&&x<=maxIso);
    const isoList=candidates.length?candidates:[Math.min(initialIso,maxIso)];
    let iso=isoList[0],raw=exposureSeconds(ev,f,iso,comp),warning=[];
    if(minTime){const match=isoList.find(x=>exposureSeconds(ev,f,x,comp)<=minTime);iso=match||isoList[isoList.length-1];raw=exposureSeconds(ev,f,iso,comp);if(raw>minTime*1.02) warning.push('Il tempo minimo richiesto non è raggiungibile con questi ISO e f/'+f+'.');}
    if(initialIso>maxIso)warning.push('ISO iniziale superiore al limite: riduci ISO iniziale o aumenta il limite.');
    let clipped=clamp(raw,TIMES[TIMES.length-1],TIMES[0]);const t=closest(TIMES,clipped);
    if(raw>30||raw<1/16000)warning.push('Esposizione calcolata fuori intervallo 30 s–1/16000 s; il valore mostrato è limitato.');
    const error=Math.log2(t/raw);
    // Mostra i valori continui, oltre a quelli Nikon arrotondati per passi.
    const fixedIsoSeconds=exposureSeconds(ev,f,initialIso,comp);
    const theoreticalIso=minTime ? initialIso*fixedIsoSeconds/minTime : initialIso;
    const formatExactTime=seconds=>seconds>=1?seconds.toFixed(2)+' s':
      '1/'+(1/seconds).toFixed(1)+' s';
    $('continuous-time').textContent=formatExactTime(fixedIsoSeconds);
    $('continuous-iso').textContent=minTime ? 'ISO '+Math.round(theoreticalIso) : 'Nessun tempo minimo';
    const liveActive=Boolean(last && $('tone-correction').checked);
    const canChange=liveActive && Math.abs(delta)>0.035;
    $('live-explanation').textContent=!last
      ? 'Anteprima spenta: vengono usati soltanto i parametri della scena.'
      : !$('tone-correction').checked
      ? 'La correzione tonale è disattivata: attivala nella sezione Calibrazione.'
      : !canChange
      ? 'Istogramma attivo, ma variazione EV inferiore a 0,04. L’iPhone potrebbe compensare automaticamente la luce.'
      : 'Variazione tonale stimata '+(delta>=0?'+':'')+delta.toFixed(2)+' EV. I valori Nikon sopra cambiano solo al superamento dei passi fotografici; qui sotto sono mostrati i valori continui.';
    $('out-time').textContent=fmtTime(t);$('out-aperture').textContent=fmtF(f);$('out-iso').textContent=String(iso);$('ev-value').textContent=ev.toFixed(2)+(liveActive?' ('+(delta>=0?'+':'')+delta.toFixed(2)+' rel.)':'');$('error-value').textContent=(error>=0?'+':'')+error.toFixed(2)+' EV';$('confidence').textContent=description;$('warnings').textContent=warning.join(' ');
    $('mini-delta').textContent=(delta>=0?'+':'')+delta.toFixed(2)+' EV';
    $('mini-median').textContent=last?(last.median*100).toFixed(0)+'%':'—';
    const steady=meterHistory.length>=5 && Math.max(...meterHistory)-Math.min(...meterHistory)<0.055;
    const calibrateActive=calibrationMatches()||Boolean(guided);
    const level=calibrateActive?(steady?'Rif. Nikon stabile':'Rif. Nikon · scena variabile'):(steady?'Scena stabile':'Stima / luce variabile');
    $('mini-quality').textContent=guided?(guided.count===3?'3 riferimenti Nikon':'Nikon '+guided.count+'/3') : level;
    $('calibration-diagnostic').textContent=calibrateActive ? 'Riferimento Nikon attivo su questa fotocamera e configurazione; la correzione live resta indicativa. '+(steady?'Lettura tonale stabile.':'La scena o l’autoesposizione iPhone stanno variando.') : 'Riferimento Nikon non applicato a questa configurazione. L’EV si basa sulla scena presunta; calibra nella stessa area/zoom per un riferimento migliore.';
    $('advice').textContent=PRESETS[$('preset').value].advice+(last&&last.high>8?' Molte aree chiare nel video: controlla le alte luci sulla Nikon.':'')+(last&&last.low>25?' Ombre profonde: evita di affidarti al solo display iPhone.':'');
    const mode=$('preset').value;
    const focus={travel:'AF-C · persone se presenti',landscape:'AF-S · punto singolo',architecture:'AF-S · punto singolo',portrait:'AF-C · rilevamento occhi',basket:'AF-C · persone · raffica H',night:'AF-S o MF · autoscatto'}[mode];
    const support={night:'Treppiede · VR OFF su supporto stabile',landscape:'Treppiede se tempo lento',architecture:'Controlla verticali e alte luci',basket:'Priorità al movimento: 1/800–1/1000 s',portrait:'Controlla la nitidezza degli occhi',travel:'Controlla il mosso a mano libera'}[mode];
    const light=(last&&last.high>8?'Alte luci da verificare · ':'')+(last&&last.low>25?'ombre profonde · ':'');
    $('context-tip').textContent=focus+' · '+support+'. '+light+(guided?'Calibrazione '+guided.count+'/3; EV indicativo.': 'EV di partenza da verificare sulla Nikon.');
    renderGuided();
    const body=$('equivalents');body.replaceChildren();
    for(const aperture of [4,5.6,8,11,16,22]){let rawT=exposureSeconds(ev,aperture,iso,comp),near=closest(TIMES,clamp(rawT,1/16000,30));const tr=document.createElement('tr');if(aperture===f)tr.className='current';for(const value of [fmtF(aperture),fmtTime(near),iso]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}
    lastOut={ev,iso,aperture:f,shutterSeconds:t,comp,source:description,rawShutterSeconds:raw,correction:delta};
  }
  function drawHistogram(bins){
    const w=graph.canvas.width,h=graph.canvas.height;
    graph.clearRect(0,0,w,h);
    const peak=Math.max(1,...bins);
    for(let i=0;i<bins.length;i++){
      const bh=(bins[i]/peak)*(h-6);
      graph.fillStyle=i>=29?'#ff9d64':i<=2?'#7aafdb':'#f5cf64';
      graph.fillRect(i*w/bins.length,h-bh,w/bins.length-1,bh);
    }
  }
  function analyze(){
    const video=$('camera');if(!stream||video.readyState<2)return;
    try{
      // Ritaglia il centro del fotogramma nello stesso rapporto mostrato dal video.
      const vw=video.videoWidth,vh=video.videoHeight;
      const cropW=vw/zoom,cropH=vh/zoom;
      context.drawImage(video,(vw-cropW)/2,(vh-cropH)/2,cropW,cropH,0,0,canvas.width,canvas.height);const data=context.getImageData(0,0,canvas.width,canvas.height).data;const metering=$('metering').value,bins=new Array(32).fill(0),samples=[];let high=0,low=0,total=0;
      for(let y=0;y<canvas.height;y+=2){for(let x=0;x<canvas.width;x+=2){let nx=(x-canvas.width/2)/(canvas.width/2),ny=(y-canvas.height/2)/(canvas.height/2),radius=Math.sqrt(nx*nx+ny*ny);if(metering==='center'&&radius>0.52)continue;if(metering==='spot'&&Math.hypot(x/canvas.width-spot.x,y/canvas.height-spot.y)>0.075)continue;const i=(y*canvas.width+x)*4;const lum=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;samples.push(lum);bins[Math.min(31,Math.floor(lum*32))]++;total++;if(lum>.95)high++;if(lum<.05)low++;}}
      if(!total)return;samples.sort((a,b)=>a-b);const median=samples[Math.floor(samples.length/2)];
      if(frozen){drawHistogram(bins);return;}
      last={median,high:100*high/total,low:100*low/total};
      meterHistory.push(median);if(meterHistory.length>10)meterHistory.shift();
      if(baseline===null){ baseline=median; frameCount=1; }$('median').textContent=(median*100).toFixed(1)+'%';$('highlights').textContent=last.high.toFixed(1)+'%';$('shadows').textContent=last.low.toFixed(1)+'%';
      drawHistogram(bins);recalculate();
    }catch(err){$('camera-status').textContent='Analisi video non disponibile: '+err.message;}
  }
  function cameraStatus(msg){$('camera-status').textContent=msg;}
  function cameraBusyUI(busy){
    cameraBusy=busy;
    $('start-camera').disabled=busy||!!stream;
    $('stop-camera').disabled=busy||!stream;
    $('switch-camera').disabled=busy||!stream;
    $('refresh-cameras').disabled=busy||!stream||!navigator.mediaDevices?.enumerateDevices;
    $('camera-device').disabled=busy||!stream||$('camera-device').options.length<2;
  }
  function cameraLabel(d,i){
    // Mostriamo SOLO il nome riportato da Safari: non deduciamo falsi sensori fisici.
    return d.label?.trim()||('Sorgente video '+(i+1));
  }
  async function refreshCameraDevices(){
    const sel=$('camera-device');
    if(!navigator.mediaDevices?.enumerateDevices){
      $('device-status').textContent='Questo Safari non consente di elencare le sorgenti video.';
      cameraBusyUI(cameraBusy);return;
    }
    try{
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');
      const actual=stream?.getVideoTracks()[0]?.getSettings()?.deviceId||selectedCameraId;
      sel.replaceChildren();
      if(!devices.length){
        sel.add(new Option('Nessuna fotocamera elencata',''));
        $('device-status').textContent='Nessuna fotocamera alternativa visibile. Prova Aggiorna oppure Inverti.';
      }else{
        devices.forEach((device,i)=>sel.add(new Option(cameraLabel(device,i),device.deviceId||'')));
        let selected=devices.find(d=>d.deviceId&&d.deviceId===actual);
        if(!selected&&devices.length===1)selected=devices[0];
        if(selected)sel.value=selected.deviceId;
        else sel.selectedIndex=0;
        $('device-status').textContent=devices.length+' sorgent'+(devices.length===1?'e video disponibile':'i video disponibili')+'. Seleziona una voce per cambiare inquadratura; Safari potrebbe raggruppare più lenti.';
      }
      cameraBusyUI(cameraBusy);
    }catch(e){
      $('device-status').textContent='Impossibile elencare le fotocamere: '+e.message;
    }
  }
  function stopCamera(){
    if(loop){clearInterval(loop);loop=null;}
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    const video=$('camera');video.pause();video.srcObject=null;
    $('camera-placeholder').hidden=false;
    $('camera-pill').textContent='Video spento';$('camera-pill').classList.remove('active');
    $('camera-label').textContent='Anteprima non attiva';
    zoomAvailable(false);last=null;baseline=null;meterHistory=[];
    setFrozen(false);calibration=null;showCalibration();
    $('median').textContent=$('highlights').textContent=$('shadows').textContent='—';
    cameraBusyUI(false);recalculate();
  }
  async function startCamera(deviceId=''){
    if(cameraBusy||stream)return;
    if(!navigator.mediaDevices?.getUserMedia){
      cameraStatus('Apri la Web App direttamente in Safari tramite HTTPS: getUserMedia non è disponibile.');return;
    }
    cameraBusyUI(true);
    cameraStatus('Richiesta autorizzazione videocamera...');
    try{
      const constraints=deviceId
        ? {deviceId:{exact:deviceId},width:{ideal:1280},height:{ideal:720}}
        : {facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}};
      const newStream=await navigator.mediaDevices.getUserMedia({audio:false,video:constraints});
      stream=newStream;
      const video=$('camera');video.srcObject=stream;
      await video.play();
      selectedCameraId=stream.getVideoTracks()[0]?.getSettings()?.deviceId||deviceId||'';
      loadCameraCalibration();
      $('camera-placeholder').hidden=true;$('camera-pill').textContent='LIVE';
      $('camera-pill').classList.add('active');
      $('camera-label').textContent=stream.getVideoTracks()[0]?.label||'Video live · nessun salvataggio';
      zoomAvailable(true);$('freeze-reading').disabled=false;video.style.transform='scale('+zoom+')';
      baseline=null;last=null;meterHistory=[];frameCount=0;
      loop=window.setInterval(analyze,500);updateROI();analyze();
      cameraStatus('Fotocamera attiva. Nessun video viene inviato al server.');
      await refreshCameraDevices();
    }catch(e){
      stopCamera();
      let msg='Impossibile avviare la fotocamera ('+e.name+'). ';
      if(deviceId)msg+='La sorgente scelta potrebbe non essere disponibile: prova Aggiorna, oppure Inverti. ';
      else msg+='Controlla il permesso fotocamera e il collegamento HTTPS. ';
      cameraStatus(msg);
    }finally{cameraBusyUI(false);}
  }
  async function switchToDevice(id){
    if(!id||cameraBusy||!stream)return;
    const oldId=stream.getVideoTracks()[0]?.getSettings()?.deviceId||selectedCameraId;
    if(id===oldId)return;
    // iOS spesso consente una sola sorgente video contemporaneamente.
    stopCamera();selectedCameraId=id;
    await startCamera(id);
    if(!stream){
      cameraStatus('Sorgente non disponibile. Prova ad avviare la fotocamera predefinita.');
      selectedCameraId='';
    }
  }
  function positionSpotMarker(){
    const video=$('camera');const wrap=$('camera-wrap-control');
    if(!stream||!video.videoWidth) return;
    const rect=video.getBoundingClientRect(), outer=wrap.getBoundingClientRect();
    const ratio=video.videoWidth/video.videoHeight;
    const imageWidth=Math.min(rect.width,rect.height*ratio);
    const imageHeight=imageWidth/ratio;
    const px=rect.left+rect.width/2+(spot.x-.5)/zoom*imageWidth;
    const py=rect.top+rect.height/2+(spot.y-.5)/zoom*imageHeight;
    $('roi').style.setProperty('--spot-x',100*clamp((px-outer.left)/outer.width,0,1)+'%');
    $('roi').style.setProperty('--spot-y',100*clamp((py-outer.top)/outer.height,0,1)+'%');
  }
  function updateROI(){
    const metering=$('metering').value;
    $('roi').className='roi roi-'+metering;
    positionSpotMarker();
    $('camera-wrap-control').classList.toggle('spot-enabled',spotTap);
  }
  function setFrozen(value){
    frozen=Boolean(value && stream && lastOut);
    $('freeze-reading').textContent=frozen?'Sblocca lettura':'Blocca lettura';
    $('freeze-reading').setAttribute('aria-pressed',String(frozen));
    $('freeze-reading').classList.toggle('on',frozen);
    $('freeze-reading').disabled=!stream;
    $('freeze-status').classList.toggle('frozen',frozen);
    $('freeze-status').textContent=frozen
      ? 'Lettura BLOCCATA: EV, tempo, diaframma e ISO sono congelati. L’istogramma continua a muoversi.'
      : 'Lettura continua: EV e valori Nikon possono aggiornarsi.';
    if(!frozen){baseline=last?last.median:null;recalculate();}
  }
  $('freeze-reading').addEventListener('click',()=>setFrozen(!frozen));
  $('spot-tap').addEventListener('click',()=>{
    spotTap=!spotTap;
    $('spot-tap').textContent='Spot al tocco: '+(spotTap?'ON':'OFF');
    $('spot-tap').setAttribute('aria-pressed',String(spotTap));
    $('spot-tap').classList.toggle('on',spotTap);
    if(spotTap){
      // Conserva la luminanza della precedente area per mostrare subito la differenza tonale.
      if(last && baseline===null) baseline=last.median;
      $('metering').value='spot';
      $('spot-status').textContent='Spot ATTIVO: tocca il punto da misurare dentro l’anteprima.';
    } else {
      $('spot-status').textContent='Spot disattivato. Puoi riattivarlo e toccare la scena.';
      $('metering').value='matrix';
    }
    updateROI();loadCameraCalibration();
    if(stream)analyze();
  });
  function handleSpotTouch(event){
    if(!spotTap || !stream) return;
    const video=$('camera');
    const rect=video.getBoundingClientRect();
    const wrap=$('camera-wrap-control').getBoundingClientRect();
    if(!video.videoWidth || !video.videoHeight) return;
    // object-fit:contain + transform:scale(zoom): use visible video image geometry.
    const naturalRatio=video.videoWidth/video.videoHeight;
    const displayedWidth=Math.min(rect.width,rect.height*naturalRatio);
    const displayedHeight=displayedWidth/naturalRatio;
    const dx=(event.clientX-(rect.left+rect.width/2))/displayedWidth;
    const dy=(event.clientY-(rect.top+rect.height/2))/displayedHeight;
    // Coordinates on the CROPPED sampling canvas (after the digital zoom).
    spot.x=clamp(0.5+dx*zoom,0.01,0.99);
    spot.y=clamp(0.5+dy*zoom,0.01,0.99);
    // Display the marker in the visible preview, matching the sampling position.
    const markerX=clamp(event.clientX-wrap.left,0,wrap.width);
    const markerY=clamp(event.clientY-wrap.top,0,wrap.height);
    $('roi').style.setProperty('--spot-x',100*markerX/wrap.width+'%');
    $('roi').style.setProperty('--spot-y',100*markerY/wrap.height+'%');
    // Non azzerare il riferimento relativo: in caso contrario il cambio di punto
    // viene immediatamente annullato dal nuovo fotogramma di riferimento.
    $('spot-status').textContent='Spot aggiornato: '+Math.round(spot.x*100)+'% orizzontale, '+Math.round(spot.y*100)+'% verticale. Tocca altrove per confrontare la luce.';
    loadCameraCalibration();if(stream)analyze();
  }
  // pointerup supporta il tocco iOS e il mouse; click è il fallback per browser più vecchi.
  let lastPointerAt=0;
  $('camera-wrap-control').addEventListener('pointerup',event=>{
    if(!spotTap || !stream)return;
    lastPointerAt=Date.now();
    handleSpotTouch(event);
  });
  $('camera-wrap-control').addEventListener('click',event=>{
    if(Date.now()-lastPointerAt<600)return;
    handleSpotTouch(event);
  });
  $('start-camera').addEventListener('click',()=>startCamera());
  $('stop-camera').addEventListener('click',()=>{stopCamera();cameraStatus('Videocamera disattivata.');});
  $('refresh-cameras').addEventListener('click',refreshCameraDevices);
  $('camera-device').addEventListener('change',event=>switchToDevice(event.target.value));
  $('switch-camera').addEventListener('click',async()=>{
    if(cameraBusy)return;
    facing=facing==='environment'?'user':'environment';
    stopCamera();selectedCameraId='';await startCamera();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange',()=>{
    if(stream&&!cameraBusy)refreshCameraDevices();
  });
  $('metering').addEventListener('change',()=>{
    spotTap=$('metering').value==='spot';
    $('spot-tap').textContent='Spot al tocco: '+(spotTap?'ON':'OFF');
    $('spot-tap').setAttribute('aria-pressed',String(spotTap));
    $('spot-tap').classList.toggle('on',spotTap);
    // Il cambio modalità conserva la lettura precedente per confrontare subito le aree.
    if(last && baseline===null)baseline=last.median;
    updateROI();loadCameraCalibration();recalculate();if(stream)analyze();
  });
  $('preset').addEventListener('change',()=>{baseline=last?last.median:null;applyPreset($('preset').value);});
  for(const id of ['aperture','iso','comp','target','iso-max','tone-correction'])$(id).addEventListener('change',recalculate);
  $('scene').addEventListener('change',()=>{baseline=last?last.median:null;recalculate();});
  $('calibrate').addEventListener('click',()=>{
    if(!stream || !last){$('calibration-status').textContent='Avvia prima la fotocamera e attendi una lettura: la calibrazione richiede una scena inquadrata.';return;}
    if(frozen){$('calibration-status').textContent='Sblocca la lettura prima di calibrare.';return;}
    const t=Number($('cal-time').value),f=Number($('cal-f').value),iso=Number($('cal-iso').value);
    const ev=Math.log2(f*f/t)-Math.log2(iso/100);
    if(!Number.isFinite(ev)) return;
    calibration={ev,median:last.median,zoom,metering:$('metering').value,spotX:spot.x,spotY:spot.y};
    calibrations[calibrationKey()]=calibration;
    const saved=saveCalibrations();showCalibration();renderGuided();recalculate();
    if(!saved)$('calibration-status').textContent+=' Attenzione: Safari non ha consentito il salvataggio permanente.';
  });
  $('reset-calibration').addEventListener('click',()=>{
    delete calibrations[calibrationKey()];delete calibrations[cameraKey()];calibration=null;saveCalibrations();showCalibration();recalculate();
  });
  $('wizard-save').addEventListener('click',()=>{
    if(!stream||!last){$('wizard-info').textContent='Avvia la videocamera e attendi una lettura prima di registrare.';return;}
    if(frozen){$('wizard-info').textContent='Sblocca la lettura prima di calibrare.';return;}
    const sec=Number($('wizard-time').value),f=Number($('wizard-f').value),iso=Number($('wizard-iso').value);
    const ev=Math.log2(f*f/sec)-Math.log2(iso/100);
    if(!Number.isFinite(ev)||!Number.isFinite(last.median))return;
    const key=guidedKey(),stage=$('wizard-stage').value;
    guidedSamples[key]=guidedSamples[key]||{};
    guidedSamples[key][stage]={ev,median:last.median,ts:Date.now()};
    const persistent=saveGuided();
    const next=STAGES.find(s=>!guidedSamples[key][s]);if(next)$('wizard-stage').value=next;
    // Non riusare una base tonale da una diversa scena.
    baseline=last.median;
    recalculate();
    $('wizard-info').textContent='Salvato '+STAGE_LABEL[stage]+': EV100 '+ev.toFixed(2)+'. '+(persistent?'Memorizzato su questo dispositivo.':'ATTENZIONE: salvataggio locale non disponibile.');
  });
  $('wizard-clear').addEventListener('click',()=>{
    if(!window.confirm('Eliminare tutte e tre le calibrazioni guidate di questa fotocamera, zoom e zona?'))return;
    delete guidedSamples[guidedKey()];saveGuided();renderGuided();recalculate();
  });
  $('copy-settings').addEventListener('click',async()=>{if(!lastOut)return;const o=lastOut;const val=`Nikon Z6 III | M | ${fmtTime(o.shutterSeconds)} | ${fmtF(o.aperture)} | ISO ${o.iso} | EV100 ${o.ev.toFixed(2)} | Comp. ${o.comp.toFixed(2)} EV | ${o.source}`;try{await navigator.clipboard.writeText(val);$('copy-feedback').textContent='Valori copiati negli appunti.';}catch(e){$('copy-feedback').textContent='Copia automatica non disponibile: seleziona manualmente i valori mostrati.';}});
  $('send-scriptable').addEventListener('click',()=>{if(!lastOut)return;const o=lastOut;const query=new URLSearchParams({ev:o.ev.toFixed(3),iso:String(o.iso),aperture:String(o.aperture),shutter:String(o.shutterSeconds)});window.location.href='scriptable:///run/Nikon%20Live%20Import?'+query.toString();});
  window.addEventListener('pagehide',stopCamera);
  updateZoom(1);$('tone-correction').checked=true;showCalibration();applyPreset('travel');$('roi').className='roi roi-matrix';
  if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
