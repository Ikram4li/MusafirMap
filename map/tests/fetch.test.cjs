const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('../resolver.js');
const place={osm_type:'node',osm_id:1,lat:'53.79',lon:'-1.75',addresstype:'city',name:'Bradford'};
test('search and Locate Me reverse lookup preserve the browser fetch receiver',async()=>{
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=function(url){
  'use strict';
  assert.equal(this,globalThis,'Browser fetch requires its global receiver');
  calls.push(url);
  return Promise.resolve(Response.json(url.includes('/reverse?')?place:[place]));
 };
 try{
  const c=new Client();
  assert.equal((await c.search('Bradford'))[0].name,'Bradford');
  assert.equal((await c.reverse(53.79,-1.75)).name,'Bradford');
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=original;}
});
