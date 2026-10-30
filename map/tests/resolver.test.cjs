const {test}=require('node:test'),assert=require('node:assert/strict');
const turf=require('@turf/turf');
const {Client,kind}=require('../resolver.js');
const polygon=turf.polygon([[[0,0],[2,0],[2,2],[0,2],[0,0]]]);
const city={osm_type:'node',osm_id:10,name:'Example',display_name:'Example, Country',lat:1,lon:1,addresstype:'city',address:{city:'Example',country_code:'gb'}};
const client=routes=>new Client({turf,fetchImpl:async url=>{const action=url.split('/').pop().split('?')[0];return Response.json(routes[action]||[]);}});
test('city label uses linked boundary and retains selected identity',async()=>{
 const c=client({parents:[{...polygon,properties:{name:'Example City',boundaryType:'administrative'}}]});
 const r=await c.resolve(city,'destination');assert.equal(r.place.key,'node/10');assert.equal(r.geometry.properties.name,'Example City');
});
test('exact relation ID is looked up before any name discovery',async()=>{
 let urls=[];const place={...city,osm_type:'relation',osm_id:33};
 const c=new Client({turf,fetchImpl:async url=>{urls.push(url);return Response.json([{...place,geojson:polygon.geometry}]);}});
 assert.equal((await c.resolve(place,'destination')).precision,'boundary');assert.equal(urls.length,1);assert.match(urls[0],/lookup\?id=relation%2F33/);
});
test('addresses, POIs, streets and postcodes stay pins even with building polygons',async()=>{
 for(const type of ['house','building','road','street','postcode','amenity']){
  const c=new Client({turf,fetchImpl:()=>{throw Error('No boundary requests for pins');}});
  const r=await c.resolve({...city,addresstype:type,geojson:polygon.geometry},'destination');assert.equal(r.geometry.geometry.type,'Point');
 }
});
test('unknown classifications do not silently become cities',()=>assert.equal(kind({type:'unexpected'}),'unknown'));
test('unrelated outlines are rejected; missing destination never becomes a circle',async()=>{
 const wrong=turf.polygon([[[10,10],[12,10],[12,12],[10,12],[10,10]]]);
 const c=client({parents:[wrong]});await assert.rejects(c.resolve(city,'destination'),{code:'missing'});
 const r=await c.resolve(city,'home');assert.equal(r.precision,'home-circle');
});
test('multiple linked boundaries require disambiguation',async()=>{
 const c=client({parents:[polygon,polygon]});await assert.rejects(c.resolve(city,'destination'),{code:'ambiguous'});
});
test('network and throttling failures are not reported as missing, even for home',async()=>{
 const c=new Client({turf,fetchImpl:async()=>Response.json({code:'busy',message:'Try later'},{status:429})});
 await assert.rejects(c.resolve(city,'home'),{code:'busy'});
});
test('successful geometry is cached and concurrent lookups are deduplicated',async()=>{
 let count=0;const c=new Client({turf,fetchImpl:async()=>{count++;return Response.json([polygon]);}});
 await Promise.all([c.resolve(city,'destination'),c.resolve(city,'destination')]);await c.resolve(city,'destination');assert.equal(count,1);
});
test('a retry can recover after an initially missing boundary',async()=>{
 let available=false;
 const c=new Client({turf,fetchImpl:async url=>Response.json(url.includes('/parents?')&&available?[polygon]:[])});
 await assert.rejects(c.resolve(city,'destination'),{code:'missing'});available=true;
 assert.equal((await c.resolve(city,'destination')).precision,'boundary');
});
