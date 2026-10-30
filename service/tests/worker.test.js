import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Geocoder,linkedRelations,linkedFeatures} from '../worker.js';
function storage(){const map=new Map();return {get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),list:async()=>map,delete:async k=>map.delete(k),setAlarm:async()=>{}};}
test('reject invalid IDs and unconfigured deployments before making requests',async()=>{
 const state={storage:storage()};
 let r=await new Geocoder(state,{}).fetch(new Request('https://musafirmap.com/api/geo/search?q=Glasgow'));
 assert.equal(r.status,503);
 r=await new Geocoder(state,{GEO_CONTACT:'https://musafirmap.com'}).fetch(new Request('https://musafirmap.com/api/geo/parents?id=1);out;'));
 assert.equal(r.status,400);
});
test('a shared queue spaces upstream requests across concurrent users and caches city boundaries',async()=>{
 const state={storage:storage()},geo=new Geocoder(state,{GEO_CONTACT:'https://musafirmap.com'}),old=globalThis.fetch,times=[];
 globalThis.fetch=async()=>{times.push(Date.now());return Response.json([{osm_type:'relation',osm_id:1}]);};
 try{
  await Promise.all([geo.fetch(new Request('https://musafirmap.com/api/geo/lookup?id=relation/1')),geo.fetch(new Request('https://musafirmap.com/api/geo/lookup?id=relation/2'))]);
  assert.ok(times[1]-times[0]>=1050);
  await geo.fetch(new Request('https://musafirmap.com/api/geo/lookup?id=relation/1'));assert.equal(times.length,2);
 }finally{globalThis.fetch=old;}
});
test('provider throttling remains a busy error, not a missing outline',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:429});
 try{const r=await new Geocoder({storage:storage()},{GEO_CONTACT:'https://musafirmap.com'}).fetch(new Request('https://musafirmap.com/api/geo/search?q=Glasgow'));assert.equal(r.status,429);assert.equal((await r.json()).code,'busy');}finally{globalThis.fetch=old;}
});

test('membership requires administrative boundary and explicit city link',()=>{
 const relation={type:'relation',id:3,tags:{boundary:'administrative'},members:[{type:'node',ref:2,role:'admin_centre'}]};
 assert.deepEqual(linkedRelations({elements:[relation]},2),[relation]);
 assert.deepEqual(linkedRelations({elements:[relation]},99),[]);
 assert.deepEqual(linkedRelations({elements:[{...relation,tags:{boundary:'protected_area'}}]},2),[]);
});
test('city nodes resolve via exact membership IDs without Overpass',async()=>{
 const old=globalThis.fetch,urls=[];
 const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,0]]]};
 globalThis.fetch=async url=>{
  urls.push(url);
  if(url.includes('/relations.json'))return Response.json({elements:[{type:'relation',id:3,tags:{boundary:'administrative'},members:[{type:'node',ref:2,role:'admin_centre'}]}]});
  assert.match(url,/osm_ids=R3/);
  return Response.json([{osm_type:'relation',osm_id:3,name:'Example City',geojson:geometry},{osm_type:'relation',osm_id:999,geojson:geometry}]);
 };
 try{
  const geo=new Geocoder({storage:storage()},{GEO_CONTACT:'https://musafirmap.com'});
  const result=await geo.fetch(new Request('https://musafirmap.com/api/geo/parents?id=2'));
  assert.equal(result.status,200);const rows=await result.json();assert.equal(rows.length,1);assert.equal(rows[0].properties.osmId,3);assert.deepEqual(rows[0].geometry,geometry);
  await geo.fetch(new Request('https://musafirmap.com/api/geo/parents?id=2'));assert.equal(urls.length,2);
 }finally{globalThis.fetch=old;}
});
test('linked polygon provider failure is retryable and never cached as missing',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>url.includes('/relations.json')?Response.json({elements:[{type:'relation',id:3,tags:{boundary:'administrative'},members:[{type:'node',ref:2,role:'label'}]}]}):new Response('',{status:503});
 try{
  const state={storage:storage()},geo=new Geocoder(state,{GEO_CONTACT:'https://musafirmap.com'});
  const r=await geo.fetch(new Request('https://musafirmap.com/api/geo/parents?id=2'));
  assert.equal(r.status,502);assert.equal((await r.json()).code,'upstream');assert.equal(await state.storage.get('parents?id=2'),undefined);
 }finally{globalThis.fetch=old;}
});
