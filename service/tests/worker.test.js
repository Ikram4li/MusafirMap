import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Geocoder,parentFeatures} from '../worker.js';
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
test('reject relations that contain the node but do not link it as a city label',()=>{
 assert.deepEqual(parentFeatures({elements:[{type:'relation',id:1,tags:{boundary:'administrative'},members:[{type:'node',ref:2,role:''}]}]},2),[]);
});
test('linked city label relation geometry is converted and keeps its provenance',()=>{
 const geometry=[{lat:0,lon:0},{lat:0,lon:2},{lat:2,lon:2},{lat:2,lon:0},{lat:0,lon:0}];
 const features=parentFeatures({elements:[{type:'relation',id:3,tags:{type:'multipolygon',boundary:'administrative',name:'Example City'},members:[{type:'node',ref:2,role:'admin_centre'},{type:'way',ref:5,role:'outer',geometry}]}]},2);
 assert.equal(features.length,1);assert.equal(features[0].geometry.type,'Polygon');assert.equal(features[0].properties.name,'Example City');assert.match(features[0].properties.source,/label/);
});
