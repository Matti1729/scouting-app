// GamesMapView: Deutschlandkarte mit Spiel-Markern (übernommen aus der
// KMH-App "In der Umgebung"). MapLibre GL im iframe (Blob-URL, damit die
// Tile-Worker die echte App-Origin erben); Marker kommen als GeoJSON per
// postMessage. Nur Web — native zeigt einen Platzhalter.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';

export interface GameMapFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  // data: MapPopupData als JSON (MapLibre reicht verschachtelte Properties nur als String durch)
  properties: { color: string; keys: string[]; title: string; data?: string };
}

/** Popup-Daten je Spielort (Adressteile jeweils nur einmal) */
export interface MapPopupMatch { id: string; date: string; time: string; age: string; home: string; away: string; type: string }
export interface MapPopupData { name: string | null; street: string | null; zip: string | null; city: string | null; matches: MapPopupMatch[] }

/**
 * Popup-Layout beim Klick auf einen Dot (spiel-popup-spec.md):
 * 'A' = kompakte Liste mit Adresszeile, scrollbar
 * 'B' = nach Tag gruppiert, mit Jahrgangsfilter und Heimverein-Zeile
 */
export const POPUP_VARIANT: 'A' | 'B' = 'A';

const POPUP_CSS =
  '.maplibregl-popup.mp-pop{max-width:none!important}'
  + '.mp-pop .maplibregl-popup-content{padding:0;background:transparent;box-shadow:none;border-radius:12px}'
  + '.mp-pop .maplibregl-popup-tip{display:none}'
  + '.mp{position:relative;width:360px;max-width:calc(100vw - 32px);background:#fff;border-radius:12px;color:#1f2328;'
  + 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",sans-serif;'
  + 'box-shadow:0 8px 28px rgba(20,30,40,.18),0 1px 3px rgba(20,30,40,.12)}'
  + '.mp::after{content:"";position:absolute;left:50%;bottom:-7px;width:14px;height:14px;background:#fff;transform:translateX(-50%) rotate(45deg);box-shadow:3px 3px 4px rgba(20,30,40,.08)}'
  + '.mp-head{display:flex;gap:10px;align-items:flex-start;padding:14px 14px 12px 16px}'
  + '.mp-title{flex:1;min-width:0}'
  + '.mp-sub{font-size:10px;color:#5b6470;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-venue{font-size:14px;font-weight:800;line-height:1.25}'
  + '.mp-addr{font-size:10px;color:#5b6470;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-icon{flex:none;width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;border:0;padding:0;background:transparent;color:#5b6470;cursor:pointer;text-decoration:none}'
  + '.mp-route{background:#eef3fd;color:#1d5fd6}'
  + '.mp-icon:focus-visible,.mp-chip:focus-visible,.mp-row:focus-visible,.mp-brow:focus-visible{outline:2px solid #1d5fd6;outline-offset:-2px}'
  + '.mp-count{padding:0 16px 6px;font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5b6470}'
  + '.mp-list{list-style:none;margin:0;padding:0}'
  + '.mp-scroll{max-height:280px;overflow-y:auto;overscroll-behavior:contain;border-radius:0 0 12px 12px}'
  + '.mp-single{padding-bottom:14px}'
  + '.mp-row{display:grid;grid-template-columns:62px 42px minmax(0,1fr);gap:12px;align-items:center;padding:9px 16px;border-top:1px solid #eef0f2;cursor:pointer}'
  + '.mp-row:hover,.mp-brow:hover{background:#f7f8f9}'
  + '.mp-day{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;white-space:nowrap}'
  + '.mp-time{font-size:13px;font-weight:700;margin-top:1px}'
  + '.mp-age{display:block;width:42px;box-sizing:border-box;padding:3px 0;border-radius:6px;background:#eef3fd;color:#1d4fb8;font-size:10px;font-weight:700;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-min{min-width:0}'
  + '.mp-teams{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-type{font-size:10px;color:#5b6470;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px}'
  + '.mp-chip{font:inherit;font-size:11px;font-weight:600;padding:5px 10px;border-radius:999px;border:1px solid #d5d9de;background:#fff;color:#1f2328;cursor:pointer}'
  + '.mp-chip.on{background:#1f2328;border-color:#1f2328;color:#fff}'
  + '.mp-blist{max-height:340px;overflow-y:auto;overscroll-behavior:contain;border-top:1px solid #eef0f2}'
  + '.mp-dayh{position:sticky;top:0;z-index:1;background:#f7f8f9;padding:8px 16px 4px;font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#5b6470}'
  + '.mp-brow{display:grid;grid-template-columns:40px 42px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 16px;border-bottom:1px solid #f0f1f3;cursor:pointer}'
  + '.mp-btime{font-size:13px;font-weight:700}'
  + '.mp-bteams{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.mp-tag{font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;border:1px solid #d5d9de;color:#5b6470;white-space:nowrap}'
  + '.mp-tag.liga{color:#1f5132;border-color:#9cc7ad}.mp-tag.test{color:#8a4b00;border-color:#f0c88a}'
  + '.mp-empty{font-size:11px;color:#5b6470;padding:20px 16px}'
  + '.mp-foot{padding:10px 16px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#5b6470}';

// Schriftgrößen wie die Spiele-Liste daneben: Teams 13/700, Zusatzzeilen 10, Labels 10 Mono
// Läuft im Karten-iframe (ES5, kein Template-Literal): Popup A/B rendern, Zeile -> Spiel öffnen
const POPUP_JS = String.raw`
var WD_S=['So','Mo','Di','Mi','Do','Fr','Sa'],WD_L=['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
var ICON_ROUTE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
var ICON_X='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
var curPopup=null;
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function dt(iso){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso||'');if(!m)return null;return{d:new Date(+m[1],+m[2]-1,+m[3]),dm:m[3]+'.'+m[2]+'.'};}
function zipCity(v){return [v.zip,v.city].filter(Boolean).join(' ');}
function addrLine(v){return [v.street,zipCity(v)].filter(Boolean).join(' · ');}
function fullAddr(v){return [v.name,v.street,zipCity(v)].filter(Boolean).join(', ');}
function routeUrl(v){var q=[v.street,zipCity(v)].filter(Boolean).join(', ')||v.name||'';return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(q);}
function head(v,sub,withAddr){var fa=fullAddr(v);
  return '<header class="mp-head"><div class="mp-title">'+(sub?'<div class="mp-sub">'+esc(sub)+'</div>':'')
  +'<div class="mp-venue">'+esc(v.name||v.street||'Spielort')+'</div>'
  +(withAddr&&addrLine(v)?'<div class="mp-addr">'+esc(addrLine(v))+'</div>':'')+'</div>'
  +'<a class="mp-icon mp-route" href="'+esc(routeUrl(v))+'" target="_blank" rel="noopener" aria-label="Route planen: '+esc(fa)+'" title="'+esc(fa)+'">'+ICON_ROUTE+'</a>'
  +'<button type="button" class="mp-icon mp-close" aria-label="Schließen">'+ICON_X+'</button></header>';}
function pairing(m,sep){return m.away?m.home+sep+m.away:m.home;}
function renderA(v){var ms=v.matches||[],n=ms.length;
  var rows=ms.map(function(m){var d=dt(m.date);
    return '<li class="mp-row" tabindex="0" data-key="'+esc(m.id)+'"><div><div class="mp-day">'+(d?WD_S[d.d.getDay()]+' '+d.dm:'')+'</div><div class="mp-time">'+esc(m.time)+'</div></div>'
    +'<span class="mp-age" title="'+esc(m.age)+'">'+esc(m.age)+'</span>'
    +'<div class="mp-min"><div class="mp-teams" title="'+esc(pairing(m,' – '))+'">'+esc(pairing(m,' – '))+'</div><div class="mp-type">'+esc(m.type)+'</div></div></li>';}).join('');
  if(n<=1)return '<div class="mp">'+head(v,null,true)+'<ul class="mp-list mp-single">'+rows+'</ul></div>';
  return '<div class="mp">'+head(v,null,true)+'<div class="mp-count">'+n+' Spiele an diesem Ort</div><ul class="mp-list mp-scroll">'+rows+'</ul></div>';}
function baseClub(h){return (h||'').replace(/\s+(II|III|2|3)$/,'').trim();}
function homeClubOf(ms){var c={},best=null,bn=0,tie=false;ms.forEach(function(m){if(!m.away)return;var b=baseClub(m.home);if(!b)return;c[b]=(c[b]||0)+1;});
  for(var k in c){if(c[k]>bn){best=k;bn=c[k];tie=false;}else if(c[k]===bn)tie=true;}return tie?null:best;}
function ageNum(a){var m=/U\s?(\d+)/i.exec(a||'');return m?+m[1]:999;}
function tagOf(t){if(/punkt|liga/i.test(t))return '<span class="mp-tag liga">Liga</span>';if(/freundschaft|test/i.test(t))return '<span class="mp-tag test">Test</span>';return t?'<span class="mp-tag">'+esc(t.replace(/spiel$/i,''))+'</span>':'';}
function listB(v,club,filter){var ms=(v.matches||[]).filter(function(m){return filter==='Alle'||m.age===filter;});
  if(!ms.length)return{html:'<div class="mp-empty">Keine Spiele für diesen Jahrgang.</div>',n:0};
  var out='',last=null;ms.forEach(function(m){if(m.date!==last){last=m.date;var d=dt(m.date);out+='<div class="mp-dayh">'+(d?WD_L[d.d.getDay()]+', '+d.dm:'')+'</div>';}
    var txt=m.away?(club&&m.home===club?'vs '+m.away:m.home+' vs '+m.away):m.home;
    out+='<div class="mp-brow" tabindex="0" data-key="'+esc(m.id)+'"><span class="mp-btime">'+esc(m.time)+'</span><span class="mp-age" title="'+esc(m.age)+'">'+esc(m.age)+'</span><span class="mp-bteams" title="'+esc(txt)+'">'+esc(txt)+'</span>'+tagOf(m.type)+'</div>';});
  return{html:out,n:ms.length};}
function renderB(v,filter){var ms=v.matches||[],club=homeClubOf(ms);
  var ages=[];ms.forEach(function(m){if(m.age&&ages.indexOf(m.age)<0)ages.push(m.age);});ages.sort(function(a,b){return ageNum(a)-ageNum(b)||a.localeCompare(b);});
  var chips=ages.length>1?'<div class="mp-chips">'+['Alle'].concat(ages).map(function(a){return '<button type="button" class="mp-chip'+(a===filter?' on':'')+'" data-age="'+esc(a)+'" aria-pressed="'+(a===filter)+'">'+esc(a)+'</button>';}).join('')+'</div>':'';
  var l=listB(v,club,filter);
  return '<div class="mp">'+head(v,club?'Heimspiele · '+club:null,false)+chips+'<div class="mp-blist">'+l.html+'</div><div class="mp-foot">'+l.n+(l.n===1?' Spiel':' Spiele')+'</div></div>';}
function openPopup(map,lngLat,v){
  if(curPopup)curPopup.remove();
  var state={filter:'Alle'};
  var popup=new maplibregl.Popup({closeButton:false,maxWidth:'none',anchor:'bottom',offset:16,className:'mp-pop',focusAfterOpen:false}).setLngLat(lngLat);
  var el=document.createElement('div');
  function draw(){el.innerHTML=POPUP_VARIANT==='B'?renderB(v,state.filter):renderA(v);}
  draw();
  el.addEventListener('click',function(e){var t=e.target;
    if(t.closest('.mp-close')){popup.remove();return;}
    var chip=t.closest('.mp-chip');if(chip){state.filter=chip.getAttribute('data-age');draw();var f=el.querySelector('.mp-chip[data-age="'+chip.getAttribute('data-age').replace(/"/g,'\"')+'"]');if(f)f.focus();return;}
    var row=t.closest('[data-key]');if(row)parent.postMessage({type:'kmh-open',key:row.getAttribute('data-key')},'*');});
  el.addEventListener('keydown',function(e){if(e.key==='Enter'){var row=e.target.closest&&e.target.closest('[data-key]');if(row)parent.postMessage({type:'kmh-open',key:row.getAttribute('data-key')},'*');}});
  // Scrollen/Klicken im Popup bewegt die Karte nicht
  ['wheel','mousedown','touchstart','touchmove','dblclick','pointerdown'].forEach(function(ev){el.addEventListener(ev,function(e){e.stopPropagation();},{passive:true});});
  popup.setDOMContent(el).addTo(map);curPopup=popup;
  popup.on('close',function(){if(curPopup===popup)curPopup=null;});
  // Popup vollständig sichtbar halten (Pfeil zeigt immer nach unten auf den Dot)
  requestAnimationFrame(function(){var box=el.getBoundingClientRect(),dx=0,dy=0;
    if(box.top<8)dy=box.top-8;if(box.left<8)dx=box.left-8;else if(box.right>innerWidth-8)dx=box.right-innerWidth+8;
    if(dx||dy)map.panBy([dx,dy],{duration:250});});
}
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&curPopup)curPopup.remove();});
`;

const MAP_HTML =
  `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>`
  + `<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>`
  + `<style>html,body,#map{height:100%;margin:0}.maplibregl-ctrl-attrib{font-size:9px}${POPUP_CSS}</style>`
  + `</head><body><div id="map"></div>`
  + `<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>`
  + `<script>var POPUP_VARIANT='${POPUP_VARIANT}';${POPUP_JS}</script>`
  + `<script>`
  // OpenFreeMap "bright": keyless Vektor-Style (Tiles laden zuverlässig im iframe).
  + `var map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/bright',center:[10.4,51.2],zoom:5.5,attributionControl:false});`
  + `map.addControl(new maplibregl.NavigationControl({showCompass:false}));`
  + `map.on('load',function(){(map.getStyle().layers||[]).forEach(function(l){var id=(l.id||'').toLowerCase();`
  + `if(l.type==='hillshade'||id.indexOf('hillshade')>-1||id.indexOf('contour')>-1||id.indexOf('terrain')>-1){try{map.setLayoutProperty(l.id,'visibility','none');}catch(e){}return;}`
  + `if(id.indexOf('state')>-1||id.indexOf('region')>-1){try{map.setLayoutProperty(l.id,'visibility','none');}catch(e){}return;}`
  + `if(l.type==='symbol'&&(id.indexOf('place')>-1||id.indexOf('city')>-1||id.indexOf('town')>-1||id.indexOf('village')>-1||id.indexOf('hamlet')>-1||id.indexOf('suburb')>-1)){try{map.setLayoutProperty(l.id,'text-field',['coalesce',['get','name:de'],['get','name:latin'],['get','name']]);}catch(e){}}`
  + `});`
  + `var lastFeatures=[];`
  + `map.addSource('games',{type:'geojson',data:{type:'FeatureCollection',features:[]}});`
  + `map.addLayer({id:'games-halo',type:'circle',source:'games',paint:{'circle-radius':10,'circle-color':['get','color'],'circle-opacity':0.25}});`
  + `map.addLayer({id:'games',type:'circle',source:'games',paint:{'circle-radius':5,'circle-color':['get','color'],'circle-stroke-width':1.5,'circle-stroke-color':'#fff'}});`
  // Hover-Hervorhebung (vom Parent per kmh-hover gesteuert): dickerer Dot "ploppt auf".
  + `map.addSource('ghl',{type:'geojson',data:{type:'FeatureCollection',features:[]}});`
  + `map.addLayer({id:'ghl-halo',type:'circle',source:'ghl',paint:{'circle-radius':16,'circle-color':['get','color'],'circle-opacity':0.35}});`
  + `map.addLayer({id:'ghl',type:'circle',source:'ghl',paint:{'circle-radius':8,'circle-color':['get','color'],'circle-stroke-width':2.5,'circle-stroke-color':'#fff'}});`
  + `map.on('click','games',function(e){var f=e.features&&e.features[0];if(!f)return;var v=null;try{v=JSON.parse(f.properties.data||'null');}catch(x){}if(!v)return;openPopup(map,f.geometry.coordinates,v);});`
  + `map.on('mouseenter','games',function(){map.getCanvas().style.cursor='pointer';});`
  + `map.on('mouseleave','games',function(){map.getCanvas().style.cursor='';});`
  + `window.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d)return;`
  + `if(d.type==='kmh-games'){lastFeatures=d.features||[];var s=map.getSource('games');if(s)s.setData({type:'FeatureCollection',features:lastFeatures});var h=map.getSource('ghl');if(h)h.setData({type:'FeatureCollection',features:[]});}`
  + `if(d.type==='kmh-hover'){var h2=map.getSource('ghl');if(!h2)return;var hit=null;if(d.key)for(var i=0;i<lastFeatures.length;i++){var kk=lastFeatures[i].properties.keys||[];if(kk.indexOf(d.key)>-1){hit=lastFeatures[i];break;}}h2.setData({type:'FeatureCollection',features:hit?[hit]:[]});}`
  + `});`
  + `parent.postMessage('kmh-map-ready','*');`
  + `});`
  + `</script></body></html>`;

export function GamesMapView({ features, hoverKey, onOpen }: { features: GameMapFeature[]; hoverKey?: string | null; onOpen?: (key: string) => void }) {
  const iframeRef = useRef<any>(null);
  const urlRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(0);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Karte meldet sich per postMessage, danach Marker pushen
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const h = (e: any) => {
      if (e?.data === 'kmh-map-ready') setMapReady((x) => x + 1);
      // Zeile im Karten-Popup angeklickt -> Spiel öffnen
      if (e?.data?.type === 'kmh-open' && e.source === iframeRef.current?.contentWindow) onOpenRef.current?.(String(e.data.key));
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);

  useEffect(() => {
    if (!mapReady || !iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage({ type: 'kmh-games', features }, '*');
    } catch (e) {}
  }, [mapReady, features]);

  // Zeilen-Hover in der Liste → zugehörigen Marker hervorheben
  useEffect(() => {
    if (!mapReady || !iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage({ type: 'kmh-hover', key: hoverKey || null }, '*');
    } catch (e) {}
  }, [mapReady, hoverKey]);

  if (Platform.OS !== 'web') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b1220' }}>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Karte nur im Web verfügbar</Text>
      </View>
    );
  }

  // Blob-URL statt srcDoc → iframe erbt die echte App-Origin (nicht "null"),
  // damit MapLibres Tile-Worker/Vektorkacheln überhaupt rendern.
  if (!urlRef.current) {
    try {
      urlRef.current = URL.createObjectURL(new Blob([MAP_HTML], { type: 'text/html;charset=utf-8' }));
    } catch (e) {}
  }

  return React.createElement('iframe' as any, {
    ref: iframeRef,
    src: urlRef.current || undefined,
    title: 'Spielekarte',
    style: { border: 'none', width: '100%', height: '100%', display: 'block' },
  });
}
