import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'; 
import * as turf from '@turf/turf';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SettingsIcon from '@mui/icons-material/Settings';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import StraightenIcon from '@mui/icons-material/Straighten';
import TerrainIcon from '@mui/icons-material/Terrain';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import { get, set } from 'idb-keyval';

// --- CONFIGURAZIONE ---
const GROSSETO_CENTER = [11.1097, 42.7630]; // [Lon, Lat]
const ZOOM_INIZIALE = 11;

function App() {
    const [gpsEnabled, setGpsEnabled] = useState(false);
    const [gpsPosition, setGpsPosition] = useState(null);
    const gpsWatchId = useRef(null);
    // --- GESTIONE GPS ---
    useEffect(() => {
      if (gpsEnabled) {
        if (navigator.geolocation) {
          gpsWatchId.current = navigator.geolocation.watchPosition(
            (pos) => {
              setGpsPosition([pos.coords.longitude, pos.coords.latitude]);
              // Aggiorna marker sulla mappa
              if (map.current) {
                if (map.current.getSource('gps-pos')) {
                  map.current.getSource('gps-pos').setData({ type: 'Point', coordinates: [pos.coords.longitude, pos.coords.latitude] });
                  map.current.setLayoutProperty('gps-dot', 'visibility', 'visible');
                } else {
                  map.current.addSource('gps-pos', { type: 'geojson', data: { type: 'Point', coordinates: [pos.coords.longitude, pos.coords.latitude] } });
                  map.current.addLayer({
                    id: 'gps-dot', type: 'circle', source: 'gps-pos',
                    paint: { 'circle-radius': 9, 'circle-color': '#1976d2', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
                  });
                }
              }
            },
            (err) => { setGpsPosition(null); },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
          );
        }
      } else {
        setGpsPosition(null);
        if (gpsWatchId.current && navigator.geolocation) {
          navigator.geolocation.clearWatch(gpsWatchId.current);
          gpsWatchId.current = null;
        }
        // Nascondi marker
        if (map.current && map.current.getLayer('gps-dot')) {
          map.current.setLayoutProperty('gps-dot', 'visibility', 'none');
        }
      }
      return () => {
        if (gpsWatchId.current && navigator.geolocation) {
          navigator.geolocation.clearWatch(gpsWatchId.current);
          gpsWatchId.current = null;
        }
      };
    }, [gpsEnabled]);

    // --- CENTRA MAPPA SU GPS ---
    const centerOnGps = () => {
      if (map.current && gpsPosition) {
        map.current.flyTo({ center: gpsPosition, zoom: 16 });
      }
    };
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [db, setDb] = useState(null);
  const [loading, setLoading] = useState("Inizializzazione...");
  const [tracksList, setTracksList] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hoverPoint, setHoverPoint] = useState(null); // Punto sincronizzato mappa-grafico

  const currentTrack = tracksList[currentIndex] || null;

  // --- 1. CARICAMENTO DATABASE (CON PERSISTENZA) ---
  useEffect(() => {
    async function init() {
      try {
        setLoading("Caricamento SQLite...");
        const SQL = await initSqlJs({ locateFile: () => wasmUrl });

        setLoading("Controllo memoria locale...");
        let buffer = await get('saved_tracks_db');

        if (!buffer) {
          setLoading("Primo avvio: download archivio...");
          const response = await fetch('/tracks_pwa.db');
          if (!response.ok) throw new Error("File tracks_pwa.db non trovato!");
          buffer = await response.arrayBuffer();
          await set('saved_tracks_db', buffer);
        }

        const database = new SQL.Database(new Uint8Array(buffer));
        setDb(database);
        initMap(database);
      } catch (err) {
        setLoading("ERRORE: " + err.message);
        console.error(err);
      }
    }
    init();
  }, []);

  // --- 2. INIZIALIZZAZIONE MAPPA ---
  const initMap = (database) => {
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        "version": 8,
        "sources": {
          "osm": { "type": "raster", "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], "tileSize": 256 }
        },
        "layers": [{"id": "osm", "type": "raster", "source": "osm"}]
      },
      center: GROSSETO_CENTER,
      zoom: ZOOM_INIZIALE
    });

    map.current.on('load', () => {
      map.current.resize();
      setLoading(null);
      refreshMapLayers(database);
    });

    map.current.on('click', (e) => handleMapClick(e, database));
  };

  // --- 3. AGGIORNAMENTO LAYER (COLORI PER TIPO) ---
  const refreshMapLayers = (database) => {
    const res = database.exec("SELECT id, coord_light, tipo_percorso FROM tracks");
    if (res.length === 0) return;

    const features = res[0].values.map(row => {
      const coords = JSON.parse(row[1]).map(c => [c[1], c[0]]); // Inversione [Lat, Lon] -> [Lon, Lat]
      return turf.lineString(coords, { id: row[0], tipo: row[2] });
    });

    const source = map.current.getSource('tracks');
    if (source) {
      source.setData(turf.featureCollection(features));
    } else {
      map.current.addSource('tracks', { type: 'geojson', data: turf.featureCollection(features) });
      map.current.addLayer({
        id: 'tracks-layer', type: 'line', source: 'tracks',
        paint: { 
          'line-width': 2.5, 'line-opacity': 0.7,
          'line-color': ['match', ['get', 'tipo'], 'MTB', '#ff0000', 'Trekking', '#0000ff', '#ff00ff']
        }
      });
    }
  };

  // --- 4. CLASSIFICAZIONE A ROTAZIONE (MTB -> Trekking -> Null) ---
  const rotateType = async () => {
    if (!currentTrack || !db) return;
    
    let nextType = null;
    if (currentTrack.tipo_percorso === null || currentTrack.tipo_percorso === 'null') nextType = 'MTB';
    else if (currentTrack.tipo_percorso === 'MTB') nextType = 'Trekking';
    else nextType = null;

    // Update DB
    db.run("UPDATE tracks SET tipo_percorso = ? WHERE id = ?", [nextType, currentTrack.id]);
    
    // Persistenza
    await set('saved_tracks_db', db.export().buffer);

    // Update UI
    const newList = [...tracksList];
    newList[currentIndex].tipo_percorso = nextType;
    setTracksList(newList);
    refreshMapLayers(db);
  };

  // --- 5. GESTIONE CLICK E RICERCA 400M ---
  const handleMapClick = (e, database) => {
    const { lng, lat } = e.lngLat;
    const offset = 0.005; // ~500m BBox
    const query = `SELECT * FROM tracks WHERE min_lat - ${offset} <= ${lat} AND max_lat + ${offset} >= ${lat} AND min_lon - ${offset} <= ${lng} AND max_lon + ${offset} >= ${lng}`;
    
    const res = database.exec(query);
    if (res.length === 0) { setTracksList([]); return; }

    const rows = res[0].values;
    const cols = res[0].columns;
    const clickPoint = turf.point([lng, lat]);

    const found = rows.map(row => Object.fromEntries(row.map((val, i) => [cols[i], val])))
                      .filter(t => {
                        const coords = JSON.parse(t.coord_light).map(c => [c[1], c[0]]);
                        return turf.pointToLineDistance(clickPoint, turf.lineString(coords), { units: 'meters' }) <= 400;
                      });

    if (found.length > 0) {
      setTracksList(found);
      setCurrentIndex(0);
    } else {
      setTracksList([]);
    }
  };

  // --- 6. SINCRONIZZAZIONE PALLINO MAPPA ---
  useEffect(() => {
    if (!map.current) return;
    if (!hoverPoint) {
      if (map.current.getLayer('hover-dot')) map.current.setLayoutProperty('hover-dot', 'visibility', 'none');
      return;
    }
    const geojson = turf.point(hoverPoint);
    if (map.current.getSource('hover-src')) {
      map.current.getSource('hover-src').setData(geojson);
      map.current.setLayoutProperty('hover-dot', 'visibility', 'visible');
    } else {
      map.current.addSource('hover-src', { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: 'hover-dot', type: 'circle', source: 'hover-src',
        paint: { 'circle-radius': 7, 'circle-color': '#000', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
      });
    }
  }, [hoverPoint]);

  // --- 7. EVIDENZIAZIONE TRACCIA SELEZIONATA ---
  useEffect(() => {
    if (!map.current || !currentTrack) return;
    const coords = JSON.parse(currentTrack.coord_light).map(c => [c[1], c[0]]);
    if (map.current.getSource('sel')) map.current.getSource('sel').setData(turf.lineString(coords));
    else {
      map.current.addSource('sel', { type: 'geojson', data: turf.lineString(coords) });
      map.current.addLayer({ id: 'sel-layer', type: 'line', source: 'sel', paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.8 } });
    }
  }, [currentTrack]);

  // Helper formattazione data
  const formatDate = (ts) => ts ? new Date(ts * 1000).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : "---";

  // --- 8. ELABORAZIONE DATI PER IL GRAFICO ---
  const chartData = currentTrack ? JSON.parse(currentTrack.altimetria).map((d, i, arr) => {
    const dist = d[0];
    const alt = d[1];
    let pendenza = 0;
    if (i > 0) {
      const dDistMetri = (dist - arr[i-1][0]) * 1000;
      const dAltMetri = alt - arr[i-1][1];
      if (dDistMetri > 0) pendenza = (dAltMetri / dDistMetri) * 100;
    }
    return { distanza: dist, quota: alt, pendenza: pendenza.toFixed(1) };
  }) : [];


  // --- GPS MARKER SYNC ---
  useEffect(() => {
    if (!map.current) return;
    if (gpsEnabled && gpsPosition) {
      if (map.current.getSource('gps-pos')) {
        map.current.getSource('gps-pos').setData({ type: 'Point', coordinates: gpsPosition });
        map.current.setLayoutProperty('gps-dot', 'visibility', 'visible');
      } else {
        map.current.addSource('gps-pos', { type: 'geojson', data: { type: 'Point', coordinates: gpsPosition } });
        map.current.addLayer({
          id: 'gps-dot', type: 'circle', source: 'gps-pos',
          paint: { 'circle-radius': 9, 'circle-color': '#1976d2', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
        });
      }
    } else {
      if (map.current.getLayer('gps-dot')) {
        map.current.setLayoutProperty('gps-dot', 'visibility', 'none');
      }
    }
  }, [gpsEnabled, gpsPosition]);

  return (
    <div style={{ position: 'fixed', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', background: '#000' }}>
      {/* BOTTONI GPS IN ALTO A DESTRA */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 1200, display: 'flex', flexDirection: 'row', gap: 12 }}>
        {gpsEnabled && gpsPosition && (
          <button
            onClick={centerOnGps}
            style={{ background: '#fff', border: 'none', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', marginRight: 8 }}
            title="Centra sulla posizione"
          >
            <CenterFocusStrongIcon sx={{ fontSize: 28, color: '#1976d2' }} />
          </button>
        )}
        <button
          onClick={() => setGpsEnabled((v) => !v)}
          style={{ background: gpsEnabled ? '#1976d2' : '#eee', border: 'none', borderRadius: '50%', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
          title={gpsEnabled ? 'Disattiva GPS' : 'Attiva GPS'}
        >
          <MyLocationIcon sx={{ fontSize: 28, color: gpsEnabled ? '#fff' : '#1976d2' }} />
        </button>
      </div>

      {loading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: '#ffeb3b', padding: '10px', textAlign: 'center', zIndex: 9999, fontSize: '13px', fontWeight: 'bold' }}>
          {loading}
        </div>
      )}

      <div ref={mapContainer} style={{ flex: 1, width: '100%', height: '100%' }} />

      {currentTrack && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'white', padding: '16px', borderTopLeftRadius: '24px', borderTopRightRadius: '24px', zIndex: 1000, boxShadow: '0 -5px 25px rgba(0,0,0,0.3)', maxHeight: '70vh' }}>
          {/* HEADER INFO */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <button 
                onClick={rotateType}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', border: 'none', color: 'white', fontSize: '12px', fontWeight: 'bold',
                  background: currentTrack.tipo_percorso === 'MTB' ? '#ff0000' : currentTrack.tipo_percorso === 'Trekking' ? '#0000ff' : '#ff00ff',
                  marginRight: '12px'
                }}
              >
                <SettingsIcon sx={{ fontSize: 18 }} /> {currentTrack.tipo_percorso === 'Trekking' ? 'Trek' : (currentTrack.tipo_percorso || 'NULL')}
              </button>
              <div style={{ flex: 1, textAlign: 'center', fontWeight: 'bold', fontSize: '1.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentTrack.nome_file}
              </div>
              <button onClick={() => setTracksList([])} style={{ background: '#eee', border: 'none', borderRadius: '50%', width: 30, height: 30, marginLeft: '12px' }}><CloseIcon sx={{ fontSize: 18 }} /></button>
            </div>
          </div>

          {/* DATI TECNICI GRIGLIA */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', padding: '10px', background: '#f5f5f5', borderRadius: '12px', marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><StraightenIcon sx={{ fontSize: 14, color: '#666' }} /> {currentTrack.lunghezza} km</div>
            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><TerrainIcon sx={{ fontSize: 14, color: '#666' }} /> +{currentTrack.dislivello} m</div>
            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><AccessTimeIcon sx={{ fontSize: 14, color: '#666' }} /> {currentTrack.durata}</div>
            <div style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><CalendarMonthIcon sx={{ fontSize: 14, color: '#666' }} /> {formatDate(currentTrack.data_epoch)}</div>
          </div>

          {/* GRAFICO PROFILO */}
          <div style={{ width: '100%', height: 110, marginBottom: '10px' }}>
            <ResponsiveContainer>
              <AreaChart 
                data={chartData}
                onMouseMove={(e) => {
                  if (e.activePayload) {
                    const idx = e.activeTooltipIndex;
                    const c = JSON.parse(currentTrack.coord_light);
                    if (c[idx]) setHoverPoint([c[idx][1], c[idx][0]]);
                  }
                }}
                onMouseLeave={() => setHoverPoint(null)}
              >
                <XAxis dataKey="distanza" tick={{ fontSize: 10 }} />
                <YAxis dataKey="quota" tick={{ fontSize: 10 }} width={30} />
                <Tooltip formatter={(value, name) => name === 'pendenza' ? `${value} %` : value} />
                <Area type="monotone" dataKey="quota" stroke="#1976d2" fill="#bbdefb" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;