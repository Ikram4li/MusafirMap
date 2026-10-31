/* Pure destination classification; a Google viewport is never an outline. */
(function(root){
  const areas=new Set(['locality','postal_town','sublocality','neighborhood','country','political']);
  const precise=new Set(['street_address','premise','subpremise','route','postal_code','postal_code_prefix','intersection','establishment','point_of_interest']);
  function kind(types=[]){
    if(types.some(t=>precise.has(t)))return types.includes('postal_code')?'postcode':types.includes('route')?'street':'poi';
    if(types.some(t=>areas.has(t)||t.startsWith('administrative_area_level_')||t.startsWith('sublocality_level_')))return 'area';
    return 'unknown';
  }
  function point(place){
    const lat=typeof place.location?.lat==='function'?place.location.lat():place.location?.lat;
    const lon=typeof place.location?.lng==='function'?place.location.lng():place.location?.lng;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('This place has no valid map position. Choose another result.');
    return {type:'Feature',properties:{},geometry:{type:'Point',coordinates:[lon,lat]}};
  }
  const api={kind,point};root.GoogleDestination=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
