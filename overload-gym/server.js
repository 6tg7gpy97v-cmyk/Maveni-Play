import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

function send(res,status,body,type='application/json'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof body==='string'?body:JSON.stringify(body));}
async function readBody(req){return await new Promise((resolve,reject)=>{let data='';req.on('data',c=>{data+=c;if(data.length>8_000_000){reject(new Error('Image too large'));req.destroy();}});req.on('end',()=>resolve(data));req.on('error',reject);});}
function extractText(j){if(j.output_text)return j.output_text;for(const item of j.output||[]){for(const c of item.content||[]){if(c.type==='output_text'&&c.text)return c.text;}}return '';}
function cleanJson(text){return text.replace(/^```(?:json)?\s*/i,'').replace(/```$/,'').trim();}

const recognitionScript = `
<script>
(function(){
  const input=document.getElementById('photoInput'); if(!input)return;
  const host=document.querySelector('.photo');
  const status=document.createElement('div'); status.id='aiRecognitionStatus'; status.style.cssText='margin-top:10px;padding:10px;border-radius:12px;background:#0c121a;border:1px solid #293548;color:#93a0b3;font-size:13px;display:none'; host.appendChild(status);
  async function compress(file){return await new Promise((resolve,reject)=>{const rd=new FileReader();rd.onerror=reject;rd.onload=()=>{const im=new Image();im.onerror=reject;im.onload=()=>{const max=1024,sc=Math.min(1,max/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*sc);c.height=Math.round(im.height*sc);c.getContext('2d').drawImage(im,0,0,c.width,c.height);resolve(c.toDataURL('image/jpeg',.75));};im.src=rd.result;};rd.readAsDataURL(file);});}
  input.addEventListener('change',async function(){const f=this.files&&this.files[0];if(!f)return;status.style.display='block';status.textContent='🤖 Identifying machine…';try{const image=await compress(f);const r=await fetch('/api/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image})});const j=await r.json();if(!r.ok)throw new Error(j.error||'Recognition failed');if(j.machine)document.getElementById('machine').value=j.machine;if(j.exercise)document.getElementById('exercise').value=j.exercise;if(j.repMin)document.getElementById('repMin').value=j.repMin;if(j.repMax)document.getElementById('repMax').value=j.repMax;if(j.increment)document.getElementById('increment').value=j.increment;const n=document.getElementById('notes');if(j.setupHint&&!n.value)n.value=j.setupHint;status.innerHTML='<b style="color:#7cff9d">AI suggestion:</b> '+(j.exercise||'Unknown exercise')+(j.machine?' · '+j.machine:'')+'<br><span>Confidence: '+(j.confidence||'unknown')+' — check the suggestion before saving.</span>';}catch(e){status.textContent='AI recognition unavailable: '+e.message+' You can still enter the machine manually.';}}
  );
})();
</script>`;

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='GET'&&(req.url==='/'||req.url==='/smart.html')){
      let html=await fs.readFile(path.join(__dirname,'smart.html'),'utf8');
      html=html.replace('</body>',recognitionScript+'</body>');
      return send(res,200,html,'text/html; charset=utf-8');
    }
    if(req.method==='GET'&&req.url==='/health') return send(res,200,{ok:true,aiConfigured:Boolean(process.env.OPENAI_API_KEY)});
    if(req.method==='POST'&&req.url==='/api/recognize'){
      if(!process.env.OPENAI_API_KEY)return send(res,503,{error:'AI backend is not configured yet'});
      const raw=await readBody(req); const {image}=JSON.parse(raw||'{}');
      if(!image||!image.startsWith('data:image/'))return send(res,400,{error:'No valid image supplied'});
      const prompt='Identify the gym machine or exercise equipment in this photo. Return ONLY valid JSON with keys machine, exercise, category, repMin, repMax, increment, setupHint, confidence. machine should include brand/model only if actually visible; otherwise use a generic machine name. exercise should be the most likely exercise performed. repMin and repMax should be sensible hypertrophy-oriented defaults, usually 8 and 12. increment is a practical kg increment such as 2.5, 5, or 10 depending on the machine. setupHint should mention visible adjustment points the user may want to remember, without inventing exact seat numbers. confidence must be high, medium, or low.';
      const api=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.6',input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:image}]}]})});
      const data=await api.json(); if(!api.ok)return send(res,502,{error:data?.error?.message||'Vision request failed'});
      let parsed; try{parsed=JSON.parse(cleanJson(extractText(data)));}catch{ return send(res,502,{error:'Could not parse machine recognition result'}); }
      return send(res,200,parsed);
    }
    return send(res,404,{error:'Not found'});
  }catch(e){return send(res,500,{error:e.message||'Server error'});}
});
server.listen(PORT,()=>console.log('Overload listening on '+PORT));
