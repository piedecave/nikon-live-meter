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
  let stream=null, loop=null, facing='environment', last=null,calibration=null,lastOut=null;
  // La prima lettura video fissa SOLO un riferimento tonale relativo.
  let baseline=null, frameCount=0;
  let context=null,canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;
  context=canvas.getContext('2d',{willReadFrequently:true});
  const graph=$('histogram').getContext('2d');
  try {const stored=JSON.parse(localStorage.getItem('nikon-live-calibration-v1')||'null');if(stored&&Number.isFinite(stored.ev)&&stored.ev>-15&&stored.ev<25) calibration=stored;}catch(e){}
  function showCalibration(){if(calibration){$('calibration-status').textContent='Calibrato: EV100 '+calibration.ev.toFixed(2)+(calibration.median!=null?' · Riferimento tonale '+Math.round(calibration.median*100)+'%':' · riferimento tonale non disponibile')+'. La correzione live è sperimentale.';}else{$('calibration-status').textContent='Nessuna calibrazione: calcolo basato sulle condizioni di luce selezionate.';}}
  function applyPreset(name){const p=PRESETS[name];$('aperture').value=String(p.f);$('iso').value=String(p.iso);$('scene').value=String(p.scene);$('target').value=String(p.target);$('iso-max').value=String(p.cap);recalculate();}
  function targetEV(){
    const scene=Number($('scene').value);
    const anchor=calibration?calibration.ev:scene;
    const reference=calibration&&calibration.median!=null?calibration.median:baseline;
    let d=0;
    if(last && reference!=null && $('tone-correction').checked){
      // Rapporto tra luminanze codificate sRGB: stima euristica, NON stop reali.
      d=clamp(0.70*Math.log2((last.median+0.03)/(reference+0.03)),-2,2);
    }
    return {ev:anchor+d,
      description:(calibration?'EV Nikon calibrato':'EV scena presunto')+
        (last && $('tone-correction').checked?' + variazione tonale live':''),
      delta:d};
  }
  // EV100 = log2(N²/t) - log2(ISO/100). A positive comp means more exposure.
  const exposureSeconds=(ev,f,iso,comp)=>f*f*100/iso*Math.pow(2,comp-ev);
  function recalculate(){
    const {ev,description,delta}=targetEV();const f=Number($('aperture').value),initialIso=Number($('iso').value),comp=Number($('comp').value),maxIso=Number($('iso-max').value),den=Number($('target').value);const minTime=den?1/den:0;
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
    $('advice').textContent=PRESETS[$('preset').value].advice+(last&&last.high>8?' Molte aree chiare nel video: controlla le alte luci sulla Nikon.':'')+(last&&last.low>25?' Ombre profonde: evita di affidarti al solo display iPhone.':'');
    const body=$('equivalents');body.replaceChildren();
    for(const aperture of [4,5.6,8,11,16,22]){let rawT=exposureSeconds(ev,aperture,iso,comp),near=closest(TIMES,clamp(rawT,1/16000,30));const tr=document.createElement('tr');if(aperture===f)tr.className='current';for(const value of [fmtF(aperture),fmtTime(near),iso]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}body.append(tr);}
    lastOut={ev,iso,aperture:f,shutterSeconds:t,comp,source:description,rawShutterSeconds:raw,correction:delta};
  }
  function analyze(){
    const video=$('camera');if(!stream||video.readyState<2)return;
    try{
      context.drawImage(video,0,0,canvas.width,canvas.height);const data=context.getImageData(0,0,canvas.width,canvas.height).data;const metering=$('metering').value,bins=new Array(32).fill(0),samples=[];let high=0,low=0,total=0;
      for(let y=0;y<canvas.height;y+=2){for(let x=0;x<canvas.width;x+=2){let nx=(x-canvas.width/2)/(canvas.width/2),ny=(y-canvas.height/2)/(canvas.height/2),radius=Math.sqrt(nx*nx+ny*ny);if(metering==='center'&&radius>0.52)continue;if(metering==='spot'&&radius>0.15)continue;const i=(y*canvas.width+x)*4;const lum=(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2])/255;samples.push(lum);bins[Math.min(31,Math.floor(lum*32))]++;total++;if(lum>.95)high++;if(lum<.05)low++;}}
      if(!total)return;samples.sort((a,b)=>a-b);const median=samples[Math.floor(samples.length/2)];last={median,high:100*high/total,low:100*low/total};
      if(baseline===null){ baseline=median; frameCount=1; }$('median').textContent=(median*100).toFixed(1)+'%';$('highlights').textContent=last.high.toFixed(1)+'%';$('shadows').textContent=last.low.toFixed(1)+'%';
      const w=graph.canvas.width,h=graph.canvas.height;graph.clearRect(0,0,w,h);const peak=Math.max(1,...bins);for(let i=0;i<bins.length;i++){const bh=(bins[i]/peak)*(h-6);graph.fillStyle=i>=29?'#ff9d64':i<=2?'#7aafdb':'#f5cf64';graph.fillRect(i*w/bins.length,h-bh,w/bins.length-1,bh);}recalculate();
    }catch(err){$('camera-status').textContent='Analisi video non disponibile: '+err.message;}
  }
  function cameraStatus(msg){$('camera-status').textContent=msg;}
  async function startCamera(){if(stream)return;if(!navigator.mediaDevices?.getUserMedia){cameraStatus('Questa pagina non può utilizzare getUserMedia. Aprila direttamente in Safari tramite HTTPS (non come file locale o WebView Scriptable).');return;}$('start-camera').disabled=true;cameraStatus('Richiesta autorizzazione videocamera...');try{stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720}}});const video=$('camera');video.srcObject=stream;await video.play();$('camera-placeholder').hidden=true;$('camera-pill').textContent='LIVE';$('camera-pill').classList.add('active');$('camera-label').textContent='Video live · nessun salvataggio';$('stop-camera').disabled=false;$('switch-camera').disabled=false;cameraStatus('Videocamera attiva: nessun fotogramma viene inviato al server.');baseline=null;frameCount=0;loop=window.setInterval(analyze,500);analyze();}catch(e){stopCamera();cameraStatus('Impossibile avviare la fotocamera ('+e.name+'). Apri in Safari con HTTPS, autorizza la fotocamera e verifica che non sia usata da un’altra app.');}finally{$('start-camera').disabled=!!stream;}}
  function stopCamera(){if(loop){clearInterval(loop);loop=null;}if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}$('camera').srcObject=null;$('camera-placeholder').hidden=false;$('camera-pill').textContent='Video spento';$('camera-pill').classList.remove('active');$('camera-label').textContent='Anteprima non attiva';$('start-camera').disabled=false;$('stop-camera').disabled=true;$('switch-camera').disabled=true;last=null;baseline=null;$('median').textContent=$('highlights').textContent=$('shadows').textContent='—';recalculate();}
  $('start-camera').addEventListener('click',startCamera);$('stop-camera').addEventListener('click',()=>{stopCamera();cameraStatus('Videocamera disattivata.');});$('switch-camera').addEventListener('click',()=>{facing=facing==='environment'?'user':'environment';stopCamera();startCamera();});
  $('metering').addEventListener('change',()=>{$('roi').className='roi roi-'+$('metering').value;baseline=null;recalculate();});
  $('preset').addEventListener('change',()=>{baseline=last?last.median:null;applyPreset($('preset').value);});
  for(const id of ['aperture','iso','comp','target','iso-max','tone-correction'])$(id).addEventListener('change',recalculate);
  $('scene').addEventListener('change',()=>{baseline=last?last.median:null;recalculate();});
  $('calibrate').addEventListener('click',()=>{const t=Number($('cal-time').value),f=Number($('cal-f').value),iso=Number($('cal-iso').value);const ev=Math.log2(f*f/t)-Math.log2(iso/100);if(!Number.isFinite(ev))return;calibration={ev,median:last?last.median:null};try{localStorage.setItem('nikon-live-calibration-v1',JSON.stringify(calibration));}catch(e){}showCalibration();recalculate();});
  $('reset-calibration').addEventListener('click',()=>{calibration=null;try{localStorage.removeItem('nikon-live-calibration-v1');}catch(e){}showCalibration();recalculate();});
  $('copy-settings').addEventListener('click',async()=>{if(!lastOut)return;const o=lastOut;const val=`Nikon Z6 III | M | ${fmtTime(o.shutterSeconds)} | ${fmtF(o.aperture)} | ISO ${o.iso} | EV100 ${o.ev.toFixed(2)} | Comp. ${o.comp.toFixed(2)} EV | ${o.source}`;try{await navigator.clipboard.writeText(val);$('copy-feedback').textContent='Valori copiati negli appunti.';}catch(e){$('copy-feedback').textContent='Copia automatica non disponibile: seleziona manualmente i valori mostrati.';}});
  $('send-scriptable').addEventListener('click',()=>{if(!lastOut)return;const o=lastOut;const query=new URLSearchParams({ev:o.ev.toFixed(3),iso:String(o.iso),aperture:String(o.aperture),shutter:String(o.shutterSeconds)});window.location.href='scriptable:///run/Nikon%20Live%20Import?'+query.toString();});
  $('tab-meter').addEventListener('click',()=>{$('view-meter').hidden=false;$('view-guide').hidden=true;$('tab-meter').classList.add('selected');$('tab-guide').classList.remove('selected');});
  $('tab-guide').addEventListener('click',()=>{$('view-meter').hidden=true;$('view-guide').hidden=false;$('tab-guide').classList.add('selected');$('tab-meter').classList.remove('selected');stopCamera();});
  window.addEventListener('pagehide',stopCamera);
  $('tone-correction').checked=true;showCalibration();applyPreset('travel');$('roi').className='roi roi-matrix';
  if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
