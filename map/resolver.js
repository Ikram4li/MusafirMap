/* Geometry resolver: provider-neutral identity, no destination radius fallback. */
(function (root) {
  'use strict';
  class LookupError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const polygonal = f => ['Polygon', 'MultiPolygon'].includes(f?.geometry?.type);
  const normalise = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function kind(p) {
    const type = (p.addresstype || p.type || '').toLowerCase();
    const category = p.category || p.class;
    if (type === 'postcode') return 'postcode';
    if (['road','street','highway'].includes(type) || category === 'highway') return 'street';
    if (['house','building','address','amenity','shop','office','tourism','leisure'].includes(type) ||
        ['building','amenity','shop','office','tourism','leisure'].includes(category)) return 'address';
    if (['city','town','village','hamlet','municipality','suburb','quarter','neighbourhood','borough','city_district','district','province','state_district','county','state','country','administrative'].includes(type)) return 'area';
    return 'unknown';
  }
  function selected(p) {
    const lat = Number(p.lat), lon = Number(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) throw new LookupError('invalid', 'This result has invalid coordinates. Choose another result.');
    return { ...p, lat, lon, key: `${p.osm_type}/${p.osm_id}`, kind: kind(p) };
  }
  class Client {
    constructor({base='/api/geo', fetchImpl=globalThis.fetch, turf=globalThis.turf}={}) {
      this.base=base; this.fetch=fetchImpl; this.turf=turf; this.cache=new Map(); this.pending=new Map();
    }
    async request(action, params) {
      const key=action+'?'+new URLSearchParams(params);
      if(this.cache.has(key)) return this.cache.get(key);
      if(this.pending.has(key)) return this.pending.get(key);
      const task=(async()=>{
        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),45000);
        try {
          const response=await this.fetch(this.base+'/'+action+'?'+new URLSearchParams(params), {signal:controller.signal});
          if(!response.ok) {
            let detail; try {detail=await response.json();} catch {}
            throw new LookupError(detail?.code || (response.status===429?'busy':'network'), detail?.message || 'The location service is unavailable. Retry in a moment.');
          }
          const data=await response.json();
          // Never cache a missing outline: Retry must be able to recover.
          if(!Array.isArray(data) || data.length) {
            if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);
            this.cache.set(key,data);
          }
          return data;
        } catch(e) {
          if(e.name==='AbortError') throw new LookupError('timeout','The location service took too long. Please retry.');
          if(e instanceof LookupError) throw e;
          throw new LookupError('network','Could not connect to the location service. Check your connection and retry.');
        } finally {clearTimeout(timer); this.pending.delete(key);}
      })();
      this.pending.set(key,task); return task;
    }
    async search(q) {return (await this.request('search',{q})).map(selected);}
    async reverse(lat,lon) {return selected(await this.request('reverse',{lat,lon}));}
    feature(p, source) {
      return {type:'Feature',properties:{name:p.name || p.display_name?.split(',')[0] || 'Selected area',source,osmId:p.osm_id,boundaryType:p.type==='administrative'?'administrative':'mapped area'},geometry:p.geojson};
    }
    valid(feature, place) {
      if(!polygonal(feature)) return false;
      try { return this.turf.booleanPointInPolygon(this.turf.point([place.lon,place.lat]),feature); } catch {return false;}
    }
    async area(place) {
      // Exact selected geometry/ID always wins over another name search.
      if(polygonal({geometry:place.geojson})) {
        const f=this.feature(place,'selected result'); if(this.valid(f,place)) return f;
      }
      if(['relation','way'].includes(place.osm_type)) {
        const rows=await this.request('lookup',{id:place.key});
        const exact=rows.find(p=>`${p.osm_type}/${p.osm_id}`===place.key);
        if(exact) {const f=this.feature(exact,'exact object'); if(this.valid(f,place))return f;}
      }
      if(place.osm_type==='node') {
        // OSM cities can be label/admin_centre members of their actual boundary.
        const rows=await this.request('parents',{id:place.osm_id});
        const matches=rows.filter(f=>this.valid(f,place));
        if(matches.length===1)return matches[0];
        if(matches.length>1)throw new LookupError('ambiguous','Several boundaries match this place. Select a named boundary result or use a precise destination.');
      }
      // Discover candidates, but never silently substitute a council or county.
      const name=place.name || place.address?.city || place.address?.town || place.address?.village;
      if(name) {
        const rows=await this.request('boundaries',{q:name,lat:place.lat,lon:place.lon,country:place.address?.country_code || ''});
        const matches=rows.filter(p=>(p.class==='boundary'||p.category==='boundary') && normalise(p.name)===normalise(name)).map(p=>this.feature(p,'matching named boundary')).filter(f=>this.valid(f,place));
        if(matches.length===1)return matches[0];
        if(matches.length>1)throw new LookupError('ambiguous','More than one outline matches this place. Choose a boundary result or a precise address.');
      }
      throw new LookupError('missing','No matching outline was found for this selection. Search for its named boundary, or choose an address or postcode.');
    }
    async resolve(raw, role) {
      const place=selected(raw);
      if(place.kind==='unknown')throw new LookupError('unknown','This result is not recognised as an area or precise location. Choose another result.');
      if(role==='destination' && place.kind!=='area')return {place,geometry:this.turf.point([place.lon,place.lat]),precision:place.kind};
      try {return {place,geometry:await this.area(place),precision:'boundary'};}
      catch(e) {
        // Missing is different from a network failure; home fallback is explicit.
        if(role==='home' && e.code==='missing')return {place,geometry:this.turf.point([place.lon,place.lat]),precision:'home-circle'};
        throw e;
      }
    }
  }
  root.MusafirResolver={Client,LookupError,kind,selected,polygonal};
  if(typeof module!=='undefined')module.exports=root.MusafirResolver;
})(globalThis);
