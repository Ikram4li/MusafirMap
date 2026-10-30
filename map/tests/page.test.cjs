const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),turf=require('@turf/turf');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean).join('\n');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let n=0;n<150;n++){if(fn())return;await pause(10);}throw Error('UI did not settle');}
const home={osm_type:'relation',osm_id:1,lat:53.8,lon:-1.75,name:'Bradford',display_name:'Bradford, UK',addresstype:'city',geojson:turf.bboxPolygon([-1.85,53.7,-1.65,53.9]).geometry};
const city={osm_type:'node',osm_id:2,lat:55.86,lon:-4.25,name:'Glasgow',display_name:'Glasgow, Scotland, UK',addresstype:'city',address:{city:'Glasgow',country_code:'gb'}};
const glasgow={...turf.bboxPolygon([-4.4,55.75,-4.1,55.98]),properties:{name:'Glasgow City',boundaryType:'administrative'}};
function setup(handler){
 const dom=new JSDOM(html,{url:'https://www.musafirmap.com/map/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.turf=turf;w.fetch=async url=>handler(url);w.AbortController=globalThis.AbortController;
 w.alert=()=>{throw Error('No modal alerts expected');};
 w.eval(fs.readFileSync(require.resolve('leaflet/dist/leaflet-src.js'),'utf8'));w.L.Browser.svg=true;
 w.eval(fs.readFileSync(path.join(__dirname,'../resolver.js'),'utf8'));w.eval(inline+"\nwindow.testRead = expression => eval(expression);");
 return {w,dom,el:id=>w.document.getElementById(id)};
}
async function choose(ui,role,q){const input=ui.el(role==='home'?'homeInput':'destInput');input.value=q;input.dispatchEvent(new ui.w.Event('input'));ui.el(role==='home'?'searchHome':'searchDest').click();const id=role==='home'?'suggestHome':'suggestDest';await until(()=>ui.el(id).querySelector('button'));ui.el(id).querySelector('button').click();await until(()=>ui.el('boundaryLoading').hidden);}
test('full page selection: explicit search, city outline, address pin, radius changes and input invalidation',async()=>{
 const urls=[];const ui=setup(async url=>{urls.push(url);const action=url.split('/').pop().split('?')[0],q=new URL(url,'https://x').searchParams.get('q');return Response.json(action==='search'?[q==='Bradford'?home:q==='Glasgow'?city:{...city,osm_id:3,addresstype:'postcode',name:'G1 1AA',display_name:'G1 1AA',lat:55.86,lon:-4.25}]:action==='parents'?[glasgow]:[]);});
 try{
  ui.el('destInput').value='Glasgow';ui.el('destInput').dispatchEvent(new ui.w.Event('input'));await pause(350);assert.equal(urls.length,0,'typing must not call Nominatim');
  await choose(ui,'home','Bradford');await choose(ui,'destination','Glasgow');
  assert.equal(ui.w.testRead('destGeometry.geometry.type'),'Polygon');assert.equal(ui.w.testRead('destMarkerLayer.getLayers().length'),0);assert.match(ui.el('selectionStatus').textContent,/Glasgow City/);
  await choose(ui,'destination','G1 1AA');assert.equal(ui.w.testRead('destGeometry.geometry.type'),'Point');assert.equal(ui.w.testRead('destOutsideLayer.getLayers().length+destInsideLayer.getLayers().length'),0);assert.equal(ui.w.testRead('destMarkerLayer.getLayers().length'),1);
  ui.el('radiusInput').value='40';ui.el('radiusInput').dispatchEvent(new ui.w.Event('change'));await until(()=>ui.el('boundaryLoading').hidden);assert.equal(ui.w.testRead('destOutsideLayer.getLayers().length+destInsideLayer.getLayers().length'),0);
  ui.el('destInput').value='Different';ui.el('destInput').dispatchEvent(new ui.w.Event('input'));assert.equal(ui.w.testRead('destGeometry'),null);assert.equal(ui.w.testRead('destMarkerLayer.getLayers().length'),0);
 }finally{ui.dom.window.close();}
});
test('late search responses cannot replace newer suggestions',async()=>{
 let release;const slow=new Promise(r=>release=r);
 const ui=setup(async url=>{const q=new URL(url,'https://x').searchParams.get('q');if(q==='Older')return slow;return Response.json([city]);});
 try{
  ui.el('destInput').value='Older';ui.el('searchDest').click();ui.el('destInput').value='Newer';ui.el('destInput').dispatchEvent(new ui.w.Event('input'));ui.el('searchDest').click();await until(()=>ui.el('suggestDest').querySelector('button'));
  release(Response.json([home]));await pause(50);assert.match(ui.el('suggestDest').textContent,/Glasgow/);assert.doesNotMatch(ui.el('suggestDest').textContent,/Bradford/);
 }finally{ui.dom.window.close();}
});
test('lookup failure leaves a clear inline error and dismisses loading overlay',async()=>{
 const ui=setup(async url=>url.includes('/search?')?Response.json([city]):Response.json({code:'busy',message:'Provider busy; retry shortly.'},{status:429}));
 try{await choose(ui,'destination','Glasgow');assert.match(ui.el('selectionStatus').textContent,/Provider busy/);assert.equal(ui.el('selectionStatus').dataset.state,'error');assert.equal(ui.w.testRead('destGeometry'),null);}finally{ui.dom.window.close();}
});
test('a slow boundary selection cannot overwrite a newer precise destination',async()=>{
 let release;const slow=new Promise(r=>release=r);
 const ui=setup(async url=>{if(url.includes('/parents?'))return slow;return Response.json([city]);});
 try{
  const p1=ui.w.testRead('pickPlace') (city,'destination');
  await pause(30);
  const p2=ui.w.testRead('pickPlace') ({...city,osm_id:4,addresstype:'postcode'},'destination');await p2;
  release(Response.json([glasgow]));await p1;
  assert.equal(ui.w.testRead('destGeometry.geometry.type'),'Point');assert.equal(ui.w.testRead('selectedPlaces.destination.place.osm_id'),4);assert.equal(ui.el('boundaryLoading').hidden,true);
 }finally{ui.dom.window.close();}
});
test('area overlaps are recalculated on units changes; home edits remove the old threshold',async()=>{
 const near={...home,osm_id:5,name:'Nearby',display_name:'Nearby area',geojson:turf.bboxPolygon([-2,53.5,0,54]).geometry};
 const ui=setup(async url=>Response.json([home]));
 try{
  await ui.w.testRead('pickPlace')(home,'home');await ui.w.testRead('pickPlace')(near,'destination');
  assert.ok(ui.w.testRead('destInsideLayer.getLayers().length')>0);assert.ok(ui.w.testRead('destOutsideLayer.getLayers().length')>0);assert.match(ui.el('selectionStatus').textContent,/straddles/);
  ui.el('unitsSelect').value='kilometers';ui.el('unitsSelect').dispatchEvent(new ui.w.Event('change'));await until(()=>ui.el('boundaryLoading').hidden);
  assert.equal(ui.w.testRead('destMarkerLayer.getLayers().length'),0);
  ui.el('homeInput').dispatchEvent(new ui.w.Event('input'));assert.equal(ui.w.testRead('homeBuffer'),null);assert.equal(ui.w.testRead('destInsideLayer.getLayers().length'),0);
 }finally{ui.dom.window.close();}
});
test('GPS denial closes loading and offers manual search',async()=>{
 const ui=setup(async()=>Response.json([]));
 Object.defineProperty(ui.w.navigator,'geolocation',{value:{getCurrentPosition:(ok,fail)=>fail({message:'Permission denied'})}});
 try{ui.el('locateBtn').click();assert.equal(ui.el('boundaryLoading').hidden,true);assert.equal(ui.el('locateBtn').disabled,false);assert.match(ui.el('selectionStatus').textContent,/Permission denied/);}finally{ui.dom.window.close();}
});
