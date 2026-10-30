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
        upstream=`https://api.openstreetmap.org/api/0.6/node/${id}/relations.json`;
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
        if(action==='parents'){
          // Discover exact membership first, then fetch only those IDs' polygons.
          // Do not depend on an Overpass query or guess a boundary from its name.
          const relations=linkedRelations(data,Number(p.get('id')));
          if(relations.length>20)return json({code:'ambiguous',message:'Too many linked boundaries for this city.'},422);
          if(relations.length){
            const lastLookup=await this.state.storage.get('lastRequest')||0;
            await new Promise(r=>setTimeout(r,Math.max(0,lastLookup+1100-Date.now())));
            await this.state.storage.put('lastRequest',Date.now());
            const lookup=await fetch(base+'/lookup?'+new URLSearchParams({...common,osm_ids:relations.map(r=>'R'+r.id).join(','),polygon_geojson:'1'}),{signal:controller.signal,headers:{'User-Agent':`MusafirMap/2 (${this.env.GEO_CONTACT})`,'Accept':'application/json'}});
            if(!lookup.ok)return json({code:lookup.status===429?'busy':'upstream',message:'The city outline provider could not complete this request. Please retry.'},lookup.status===429?429:502);
            const rows=await lookup.json();
            if(!Array.isArray(rows))throw Error('Invalid boundary response');
            data=linkedFeatures(relations,rows);
          }else data=[];
        }
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
export function linkedRelations(data,nodeId){
  if(!Array.isArray(data.elements))throw Error('Invalid membership response');
  return data.elements.filter(e=>e.type==='relation'&&e.tags?.boundary==='administrative'&&(e.members||[]).some(m=>m.type==='node'&&m.ref===nodeId&&['label','admin_centre'].includes(m.role)));
}
export function linkedFeatures(relations,rows){
  const ids=new Set(relations.map(r=>r.id));
  return rows.filter(r=>r.osm_type==='relation'&&ids.has(r.osm_id)&&['Polygon','MultiPolygon'].includes(r.geojson?.type)).map(r=>({type:'Feature',geometry:r.geojson,properties:{name:r.name||'Administrative area',osmId:r.osm_id,source:'OSM label/admin centre link',boundaryType:'administrative'}}));
}
