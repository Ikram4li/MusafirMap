const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const turf=require('@turf/turf');
const {kind,point}=require('../google-destination.js');
test('POIs, streets and postcodes are pins; political areas are outlines; unknown types fail closed',()=>{
 for(const t of ['mosque','gym','restaurant','store'])assert.equal(kind([t,'point_of_interest','establishment']),'poi');
 assert.equal(kind(['postal_code']),'postcode');assert.equal(kind(['route']),'street');
 for(const t of ['locality','postal_town','administrative_area_level_2','country'])assert.equal(kind([t,'political']),'area');
 assert.equal(kind([]),'unknown');
 assert.throws(()=>point({location:{lat:NaN,lng:1}}));
 assert.equal(point({location:{lat:1,lng:2},viewport:{}}).geometry.type,'Point');
});
async function setup(){
 const dom=new JSDOM(fs.readFileSync(__dirname+'/../index.html','utf8'),{url:'https://musafirmap.com/map/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.turf=turf;w.AbortController=AbortController;w.URLSearchParams=URLSearchParams;const layers=[];
 class Data{constructor(){this.rows=[];layers.push(this);}setStyle(fn){this.style=fn;}addGeoJson(f){this.rows.push(f);}forEach(fn){[...this.rows].forEach(fn);}remove(f){this.rows=this.rows.filter(x=>x!==f);}}
 class Map{addListener(){}getBounds(){return null;}fitBounds(){}setCenter(){}setZoom(){}}
 class Places extends w.HTMLElement{}
 w.customElements.define('mock-places',Places);
 w.google={maps:{importLibrary:async n=>n==='maps'?{Map,Data}:{PlaceAutocompleteElement:Places},ControlPosition:{LEFT_BOTTOM:1}}};
 const boundary=turf.polygon([[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]);
 const home={osm_type:'relation',osm_id:1,lat:'0',lon:'0',name:'Home',display_name:'Home',addresstype:'city',geojson:boundary.geometry};
 const calls=[];w.fetch=async url=>{calls.push(url);return Response.json(url.includes('/search')?[home]:home);};
 w.eval(fs.readFileSync(__dirname+'/../resolver.js','utf8'));w.eval(fs.readFileSync(__dirname+'/../google-destination.js','utf8'));
 for(const m of dom.serialize().matchAll(/<script>([\s\S]*?)<\/script>/g))w.eval(m[1]);
 await w.initMusafirGoogle();
 const widget=w.document.querySelector('mock-places');
 async function pick(types,lat,lng){const e=new w.Event('gmp-select');e.placePrediction={mainText:{toString:()=> 'Test venue'},toPlace:()=>({types,location:{lat:()=>lat,lng:()=>lng},formattedAddress:'Test place',fetchFields:async()=>{}})};widget.dispatchEvent(e);await tick();}
 return {dom,w,layers,calls,widget,pick};
}
const tick=()=>new Promise(r=>setTimeout(r,60));
test('POI selection draws neutral then inside/outside pins after home lookup; edits clear results',async()=>{
 const a=await setup();try{
 await a.pick(['mosque','point_of_interest'],0,0);
 assert.equal(a.layers[5].rows[0].properties.color,'#333');assert.equal(a.calls.length,0);
 const input=a.w.document.getElementById('homeInput');input.value='Home';a.w.document.getElementById('searchHome').click();await tick();
 a.w.document.querySelector('#suggestHome button').click();await tick();
 assert.equal(a.layers[5].rows[0].properties.color,'#c0392b');
 await a.pick(['gym','establishment'],10,10);assert.equal(a.layers[5].rows[0].properties.color,'#27ae60');
 a.widget.dispatchEvent(new a.w.Event('input'));assert.equal(a.layers[5].rows.length,0);
 }finally{a.dom.window.close();}
});
test('city selection requests boundary choices without drawing a viewport or pin',async()=>{
 const a=await setup();try{await a.pick(['locality','political'],0,0);assert.equal(a.calls.length,1);assert.equal(a.layers[5].rows.length,0);assert.ok(a.w.document.querySelector('#suggestDest button'));}finally{a.dom.window.close();}
});
test('typing cancels a pending Google details result',async()=>{
 const a=await setup();try{
 let finish;const wait=new Promise(r=>finish=r);const e=new a.w.Event('gmp-select');
 e.placePrediction={toPlace:()=>({types:['establishment'],location:{lat:()=>0,lng:()=>0},fetchFields:()=>wait})};
 a.widget.dispatchEvent(e);a.widget.dispatchEvent(new a.w.Event('input'));finish();await tick();assert.equal(a.layers[5].rows.length,0);
 }finally{a.dom.window.close();}
});
