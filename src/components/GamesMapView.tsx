// GamesMapView: Deutschlandkarte mit Spiel-Markern (übernommen aus der
// KMH-App "In der Umgebung"). MapLibre GL im iframe (Blob-URL, damit die
// Tile-Worker die echte App-Origin erben); Marker kommen als GeoJSON per
// postMessage. Nur Web — native zeigt einen Platzhalter.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Platform } from 'react-native';

export interface GameMapFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { color: string; keys: string[]; title: string };
}

const MAP_HTML =
  `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/>`
  + `<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>`
  + `<style>html,body,#map{height:100%;margin:0}.maplibregl-ctrl-attrib{font-size:9px}.maplibregl-popup-content{max-height:280px;overflow-y:auto}</style>`
  + `</head><body><div id="map"></div>`
  + `<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>`
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
  + `map.on('click','games',function(e){var f=e.features&&e.features[0];if(!f)return;new maplibregl.Popup({closeButton:false,maxWidth:'320px'}).setLngLat(f.geometry.coordinates).setHTML('<div style="font:12px sans-serif;line-height:1.5">'+f.properties.title+'</div>').addTo(map);});`
  + `map.on('mouseenter','games',function(){map.getCanvas().style.cursor='pointer';});`
  + `map.on('mouseleave','games',function(){map.getCanvas().style.cursor='';});`
  + `window.addEventListener('message',function(ev){var d=ev&&ev.data;if(!d)return;`
  + `if(d.type==='kmh-games'){lastFeatures=d.features||[];var s=map.getSource('games');if(s)s.setData({type:'FeatureCollection',features:lastFeatures});var h=map.getSource('ghl');if(h)h.setData({type:'FeatureCollection',features:[]});}`
  + `if(d.type==='kmh-hover'){var h2=map.getSource('ghl');if(!h2)return;var hit=null;if(d.key)for(var i=0;i<lastFeatures.length;i++){var kk=lastFeatures[i].properties.keys||[];if(kk.indexOf(d.key)>-1){hit=lastFeatures[i];break;}}h2.setData({type:'FeatureCollection',features:hit?[hit]:[]});}`
  + `});`
  + `parent.postMessage('kmh-map-ready','*');`
  + `});`
  + `</script></body></html>`;

export function GamesMapView({ features, hoverKey }: { features: GameMapFeature[]; hoverKey?: string | null }) {
  const iframeRef = useRef<any>(null);
  const urlRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(0);

  // Karte meldet sich per postMessage, danach Marker pushen
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const h = (e: any) => {
      if (e?.data === 'kmh-map-ready') setMapReady((x) => x + 1);
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
      urlRef.current = URL.createObjectURL(new Blob([MAP_HTML], { type: 'text/html' }));
    } catch (e) {}
  }

  return React.createElement('iframe' as any, {
    ref: iframeRef,
    src: urlRef.current || undefined,
    title: 'Spielekarte',
    style: { border: 'none', width: '100%', height: '100%', display: 'block' },
  });
}
