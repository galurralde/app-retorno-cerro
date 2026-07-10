import { calcularDistancia, calcularRumbo } from './utils/geo';
import { useEffect, useRef, useState } from 'react';

function App() {
  const [puntoPartida, setPuntoPartida] = useState(null);
  const [posicionActual, setPosicionActual] = useState(null);
  const [distancia, setDistancia] = useState(null);
  const [rumbo, setRumbo] = useState(null);
  const [errorGps, setErrorGps] = useState(null);
  const [modoCamara, setModoCamara] = useState(false);
  const [migajas, setMigajas] = useState([]);

  // FILTROS DE SENSORES
  const brujulaFiltrada = useRef(0);
  const betaFiltrado = useRef(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) setPuntoPartida(JSON.parse(guardado));

    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
  }, []);

  const registrarPuntoPartida = () => {
    if (!navigator.geolocation) {
      setErrorGps("Tu navegador no soporta GPS.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPuntoPartida(coord);
        setMigajas([coord]);
        localStorage.setItem('puntoPartida', JSON.stringify(coord));
        localStorage.setItem('migajas', JSON.stringify([coord]));
        alert("¡Base de retorno fijada!");
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true }
    );
  };

  useEffect(() => {
    if (!puntoPartida) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const actual = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPosicionActual(actual);

        const dist = calcularDistancia(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        const rum = calcularRumbo(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        
        setDistancia(dist.toFixed(2));
        setRumbo(rum);

        setMigajas((prevMigajas) => {
          const ultimaMigaja = prevMigajas[prevMigajas.length - 1];
          if (!ultimaMigaja) return prevMigajas;

          const distALastMigaja = calcularDistancia(actual.lat, actual.lon, ultimaMigaja.lat, ultimaMigaja.lon);
          // Registra un hito estable cada 15 metros
          if (distALastMigaja > 0.015) { 
            const nuevasMigajas = [...prevMigajas, { lat: actual.lat, lon: actual.lon }];
            localStorage.setItem('migajas', JSON.stringify(nuevasMigajas));
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  useEffect(() => {
    const manejarOrientacion = (event) => {
      let headingRaw = event.webkitCompassHeading || (360 - event.alpha);
      let betaRaw = event.beta || 0;

      if (headingRaw) {
        let diff = headingRaw - brujulaFiltrada.current;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        
        brujulaFiltrada.current += diff * 0.15; 
        betaFiltrado.current += (betaRaw - betaFiltrado.current) * 0.15;
      }
    };

    window.addEventListener('deviceorientation', manejarOrientacion, true);
    return () => window.removeEventListener('deviceorientation', manejarOrientacion, true);
  }, []);

  useEffect(() => {
    async function activarCamara() {
      if (modoCamara) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } }, audio: false });
          if (videoRef.current) { videoRef.current.srcObject = stream; streamRef.current = stream; }
        } catch (err) {
          try {
            const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (videoRef.current) { videoRef.current.srcObject = fallback; streamRef.current = fallback; }
          } catch (e) { setModoCamara(false); }
        }
      } else {
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      }
    }
    activarCamara();
  }, [modoCamara]);

  // RENDERIZADO RA OPTIMIZADO CON IDENTIFICADOR DE GOTAS
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 1 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const loopRenderizado = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- GOTAS FLOTANTES DE ENERGÍA + LEYENDA NUMÉRICA ---
      // Mostramos las últimas 4 migajas registradas
      const indicesMostrar = [];
      for (let i = Math.max(0, migajas.length - 4); i < migajas.length; i++) {
        indicesMostrar.push(i);
      }
      
      indicesMostrar.forEach((migajaIndex) => {
        const migaja = migajas[migajaIndex];
        const rumboGotita = calcularRumbo(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);
        const distanciaGotita = calcularDistancia(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);

        let diffGotita = rumboGotita - brujulaFiltrada.current;
        diffGotita = ((diffGotita + 180) % 360) - 180;

        // Si la gota está en el campo visual frontal
        if (Math.abs(diffGotita) < 55) {
          const gotaX = (canvas.width / 2) + (diffGotita * (canvas.width / 75));
          const factorDist = Math.min(distanciaGotita, 0.08) / 0.08; // Rango visual de 80 metros
          const offsetInc = (betaFiltrado.current - 40) * 3.5;
          const gotaY = (canvas.height * 0.45) + (factorDist * (canvas.height * 0.4)) - offsetInc;

          const radioGota = 12 * (1 - factorDist * 0.5); // Escala visual por cercanía

          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#00E5FF';
          
          // Gota exterior holográfica
          ctx.beginPath();
          ctx.arc(gotaX, gotaY, radioGota + 6, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Núcleo sólido
          ctx.beginPath();
          ctx.arc(gotaX, gotaY, radioGota, 0, 2 * Math.PI);
          ctx.fillStyle = '#00E5FF';
          ctx.fill();

          // LEYENDA NUMÉRICA FLOTANTE DECRECIENTE
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          // El punto 0 es la Base. Los siguientes son 1, 2, 3...
          const textoEtiqueta = migajaIndex === 0 ? "BASE" : `PUNTO ${migajaIndex}`;
          ctx.fillText(textoEtiqueta, gotaX, gotaY - (radioGota + 12));
          
          ctx.restore();
        }
      });

      // --- GRAN FLECHA CENTRAL DE RUTA EN EL SUELO ---
      // Apuntamos siempre al hito más reciente para guiar el camino desandado
      const destinoUltimo = migajas[migajas.length - 1];
      const rumboHaciaAtras = calcularRumbo(posicionActual.lat, posicionActual.lon, destinoUltimo.lat, destinoUltimo.lon);
      const distAlUltimo = calcularDistancia(posicionActual.lat, posicionActual.lon, destinoUltimo.lat, destinoUltimo.lon);

      // Si estamos encima del punto (menos de 6 metros), congelamos rotación para evitar fluctuación loca
      let rotacionFlechaFinal = rumboHaciaAtras - brujulaFiltrada.current;
      if (distAlUltimo < 0.006) {
        rotacionFlechaFinal = 0; 
      }

      const centroX = canvas.width / 2;
      const offsetInclinacion = (betaFiltrado.current - 40) * 3;
      const centroY = (canvas.height * 0.82) - offsetInclinacion;

      ctx.save();
      ctx.translate(centroX, centroY);
      ctx.rotate((rotacionFlechaFinal * Math.PI) / 180);

      ctx.lineWidth = 6;
      ctx.strokeStyle = distAlUltimo < 0.006 ? '#4CAF50' : '#2196F3'; // Se vuelve verde cuando "absorbes" el punto
      ctx.fillStyle = distAlUltimo < 0.006 ? 'rgba(76, 175, 80, 0.25)' : 'rgba(33, 150, 243, 0.25)';
      ctx.shadowBlur = 20;
      ctx.shadowColor = distAlUltimo < 0.006 ? '#4CAF50' : '#2196F3';

      ctx.beginPath();
      ctx.moveTo(0, -65);
      ctx.lineTo(25, 15);
      ctx.lineTo(10, 8);
      ctx.lineTo(10, 45);
      ctx.lineTo(-10, 45);
      ctx.lineTo(-10, 8);
      ctx.lineTo(-25, 15);
      ctx.closePath();
      
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const intervalo = setInterval(loopRenderizado, 30);
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, migajas]);

  // COMPARTIR REDES: CORRECCIÓN DE MAPEO DE LÍNEA RECTA
  const compartirRutaRedes = () => {
    if (migajas.length < 2) return;

    const shareCanvas = document.createElement('canvas');
    shareCanvas.width = 600;
    shareCanvas.height = 600;
    const sCtx = shareCanvas.getContext('2d');

    sCtx.fillStyle = '#1e1e24';
    sCtx.fillRect(0, 0, shareCanvas.width, shareCanvas.height);

    // Rejilla de Radar de fondo
    sCtx.strokeStyle = 'rgba(255,255,255,0.04)';
    sCtx.lineWidth = 1;
    for(let i=0; i<600; i+=50) {
      sCtx.beginPath(); sCtx.moveTo(i, 0); sCtx.lineTo(i, 600); sCtx.stroke();
      sCtx.beginPath(); sCtx.moveTo(0, i); sCtx.lineTo(600, i); sCtx.stroke();
    }

    const lats = migajas.map(m => m.lat);
    const lons = migajas.map(m => m.lon);
    
    let minLat = Math.min(...lats); let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons); let maxLon = Math.max(...lons);
    
    // CORRECCIÓN MATEMÁTICA: Si es una línea recta pura, forzamos un margen para evitar división por cero
    if (maxLat - minLat < 0.0005) { minLat -= 0.0005; maxLat += 0.0005; }
    if (maxLon - minLon < 0.0005) { minLon -= 0.0005; maxLon += 0.0005; }

    const mapPoint = (lat, lon) => {
      const padding = 120;
      const x = padding + ((lon - minLon) / (maxLon - minLon)) * (600 - padding * 2);
      const y = (600 - padding) - ((lat - minLat) / (maxLat - minLat)) * (600 - padding * 2);
      return { x, y };
    };

    // Dibujar trazo del Sendero Neón
    sCtx.strokeStyle = '#00E5FF';
    sCtx.lineWidth = 7;
    sCtx.lineCap = 'round';
    sCtx.lineJoin = 'round';
    sCtx.shadowBlur = 15;
    sCtx.shadowColor = '#00E5FF';
    
    sCtx.beginPath();
    migajas.forEach((migaja, index) => {
      const pt = mapPoint(migaja.lat, migaja.lon);
      if (index === 0) sCtx.moveTo(pt.x, pt.y);
      else sCtx.lineTo(pt.x, pt.y);
    });
    sCtx.stroke();

    // Marcar hitos en el mapa generado
    sCtx.shadowBlur = 0;
    migajas.forEach((migaja, index) => {
      const pt = mapPoint(migaja.lat, migaja.lon);
      sCtx.beginPath();
      sCtx.arc(pt.x, pt.y, index === 0 ? 9 : 5, 0, 2 * Math.PI);
      sCtx.fillStyle = index === 0 ? '#4CAF50' : '#00E5FF';
      sCtx.fill();
    });

    // Encabezado Deportivo
    sCtx.fillStyle = '#ffffff';
    sCtx.font = 'bold 26px Arial';
    sCtx.fillText("¡RETORNO SEGURO COMPLETADO! 🏔️", 40, 55);
    
    sCtx.font = '14px Arial';
    sCtx.fillStyle = '#aaaaaa';
    sCtx.fillText(`Distancia total de la travesía: ${distancia || 0} Km`, 40, 90);
    sCtx.fillText(`Puntos de control superados: ${migajas.length - 1}`, 40, 110);

    // PANEL DE SPONSORS ESTRATÉGICO
    sCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    sCtx.fillRect(40, 500, 520, 65);
    sCtx.fillStyle = '#00E5FF';
    sCtx.font = 'bold 11px Arial';
    sCtx.fillText("SPONSORS OFICIALES:", 55, 522);
    sCtx.fillStyle = '#ffffff';
    sCtx.font = 'italic 13px Arial';
    sCtx.fillText("Casa de Deportes / Municipio Local / Agua Mineral de Montaña", 55, 545);

    const imageURI = shareCanvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.download = `Ruta_Cerro_Seguro_${Date.now()}.png`;
    link.href = imageURI;
    link.click();
  };

  const rotacionMiniBrujula = rumbo !== null ? (rumbo - brujulaFiltrada.current) : 0;
  const errorDireccion = ((rotacionMiniBrujula + 180) % 360) - 180;
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

  // Se activa el botón al estar cerca de la base (< 30 metros) tras registrar camino
  const listoParaCompartir = distancia !== null && parseFloat(distancia) < 0.03 && migajas.length > 2;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh', position: 'relative' }}>
      
      {modoCamara && (
        <>
          <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
          <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: -1 }} />
        </>
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: modoCamara ? '0 2px 4px black' : 'none' }}>Retorno Seguro RA 🏔️</h1>

      {!puntoPartida ? (
        <div style={{ marginTop: '80px' }}>
          <button onClick={registrarPuntoPartida} style={{ padding: '18px 35px', fontSize: '18px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer' }}>
            Fijar Punto de Partida
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => setModoCamara(!modoCamara)} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer' }}>
            {modoCamara ? "🔋 Activar Modo Económico" : "📷 Activar Vista Holográfica RA"}
          </button>

          {listoParaCompartir && (
            <button onClick={compartirRutaRedes} style={{ padding: '14px 28px', margin: '10px', fontSize: '15px', fontWeight: 'bold', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255,152,0,0.5)', zIndex: 10, position: 'relative' }}>
              🔥 Compartir Mapa de Logros
            </button>
          )}

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>👣 Gotas Recolectables: {migajas.length}</span>
          </div>

          {estaDesviado && modoCamara && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', border: '12px solid rgba(255,107,107,0.5)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 5 }} />
          )}

          <div style={{ position: 'fixed', bottom: '25px', right: '25px', width: '75px', height: '75px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.8)', border: estaDesviado ? '2px solid #ff6b6b' : '2px solid #4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <svg style={{ width: '40px', height: '40px', transform: `rotate(${rotacionMiniBrujula}deg)`, fill: estaDesviado ? '#ff6b6b' : '#4CAF50' }} viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>

          <br />
          <button onClick={() => { if(confirm("¿Borrar ruta activa?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '15px', fontSize: '11px', marginTop: '20px' }}>
            Reiniciar Todo
          </button>
        </div>
      )}
    </div>
  );
}

export default App;