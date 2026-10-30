// All users share one queue. Public Nominatim: explicit searches only, <=1/sec.
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/geo/'))return new Response('Not found',{status:404});
    return env.GEOCODER.get(env.GEOCODER.idFromName('shared')).fetch(request);
  }
};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export class Geocoder {
  constructor(state,env){this.state=state;this.env=env;this.queue=Promise.resolve();this.depth=0;this.responses=new Map();}
  async fetch(request){
    const u=new URL(request.url), action=u.pathname.split('/').pop(), p=u.searchParams;
    if(request.method!=='GET')return json({code:'invalid',message:'GET required.'},405);
    if(!this.env.GEO_CONTACT)return json({code:'setup',message:'The location service has not been configured yet.'},503);
    const origin=request.headers.get('Origin');
    if(origin && origin!==u.origin)return json({code:'invalid',message:'Use the map website to search.'},403);
    let upstream,options={};
    const common={format:'jsonv2',addressdetails:'1','accept-language':'en'};
    const base=this.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org';
    const coords=()=>{const lat=Number(p.get('lat')),lon=Number(p.get('lon'));if(!p.has('lat')||!p.has('lon')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Invalid coordinates');return {lat,lon};};
    try {
      if(action==='search'||action==='boundaries'){
        const q=p.get('q')?.trim();if(!q||q.length<3||q.length>200)throw Error('Enter 3–200 characters');
        const params={...common,q,limit:'10',dedupe:'0'};
        if(action==='boundaries'){
          const {lat,lon}=coords();Object.assign(params,{polygon_geojson:'1',bounded:'1',viewbox:[Math.max(-180,lon-1),Math.min(90,lat+1),Math.min(180,lon+1),Math.max(-90,lat-1)].join(',')});
          const country=p.get('country');if(country){if(!/^[a-z]{2}$/.test(country))throw Error('Invalid country');params.countrycodes=country;}
        }
        upstream=base+'/search?'+new URLSearchParams(params);
      }else if(action==='lookup'){
        const match=/^(node|way|relation)\/(\d+)$/.exec(p.get('id')||'');if(!match)throw Error('Invalid place ID');
        upstream=base+'/lookup?'+new URLSearchParams({...common,osm_ids:match[1][0].toUpperCase()+match[2],polygon_geojson:'1'});
      }else if(action==='reverse'){
        upstream=base+'/reverse?'+new URLSearchParams({...common,...coords(),zoom:'10',polygon_geojson:'1'});
      }else if(action==='parents'){
        const id=p.get('id');if(!/^\d+$/.test(id||''))throw Error('Invalid node ID');
        upstream='https://overpass-api.de/api/interpreter';
        options={method:'POST',body:new URLSearchParams({data:`[out:json][timeout:20];node(${id})->.label;rel(bn.label)["boundary"="administrative"];out body geom;`})};
      }else return json({code:'invalid',message:'Unknown operation'},404);
    }catch(e){return json({code:'invalid',message:e.message},400);}
    const key=action+'?'+p.toString();
    const memory=this.responses.get(key);
    if(memory?.expires>Date.now())return json(memory.data);
    const saved=await this.state.storage.get(key);
    if(saved?.expires>Date.now())return json(saved.data);
    if(this.depth>=8)return json({code:'busy',message:'Location searches are busy. Please retry shortly.'},429);
    this.depth++;
    const task=this.queue.then(async()=>{
      const existing=await this.state.storage.get(key);if(existing?.expires>Date.now())return json(existing.data);
      const last=await this.state.storage.get('lastRequest')||0;
      await new Promise(r=>setTimeout(r,Math.max(0,last+1100-Date.now())));
      await this.state.storage.put('lastRequest',Date.now());
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
      try{
        const response=await fetch(upstream,{...options,signal:controller.signal,headers:{'User-Agent':`MusafirMap/2 (${this.env.GEO_CONTACT})`,'Accept':'application/json'}});
        if(!response.ok)return json({code:response.status===429?'busy':'upstream',message:response.status===429?'The location provider is busy. Retry shortly.':'The boundary provider could not complete this request. Please retry.'},response.status===429?429:502);
        let data=await response.json();
        if(data.error)return json({code:'missing',message:'No mapped location was found here.'},404);
        if(action==='parents')data=parentFeatures(data,Number(p.get('id')));
        // Brief shared in-memory cache also avoids duplicate submitted searches.
        // Address queries and reverse coordinates are never written to durable storage.
        if(this.responses.size>=100)this.responses.delete(this.responses.keys().next().value);
        this.responses.set(key,{data,expires:Date.now()+300000});
        // Positive city boundaries may persist; never store searched addresses/GPS.
        if(['lookup','parents','boundaries'].includes(action) && data.length){
          await this.state.storage.put(key,{data,expires:Date.now()+86400000});
          await this.state.storage.setAlarm(Date.now()+86400000);
        }
        return json(data);
      }catch(e){return json({code:e.name==='AbortError'?'timeout':'network',message:e.name==='AbortError'?'The location provider timed out. Please retry.':'The location provider could not be reached.'},504);}
      finally{clearTimeout(timer);}
    });
    this.queue=task.catch(()=>{});
    try{return await task;}finally{this.depth--;}
  }
  async alarm(){
    for(const [key,value]of await this.state.storage.list())if(key!=='lastRequest'&&value.expires<=Date.now())await this.state.storage.delete(key);
    await this.state.storage.setAlarm(Date.now()+86400000);
  }
}
// Only relations explicitly linking this node as their city label/admin centre.
// Overpass supplies geometry for member ways; preserve disconnected rings/holes.
import osmtogeojson from 'osmtogeojson';
export function parentFeatures(data,nodeId){
  const ids=new Set((data.elements||[]).filter(e=>e.type==='relation'&&(e.members||[]).some(m=>m.type==='node'&&m.ref===nodeId&&['label','admin_centre'].includes(m.role))).map(e=>'relation/'+e.id));
  return osmtogeojson(data).features.filter(f=>ids.has(f.id)&&['Polygon','MultiPolygon'].includes(f.geometry?.type)).map(f=>({...f,properties:{...f.properties,name:f.properties.name||'Administrative area',source:'OSM label/admin centre link',boundaryType:'administrative'}}));
}
