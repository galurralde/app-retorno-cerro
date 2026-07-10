import { useEffect, useState, useRef } from 'react';
import { calcularDistancia, calcularRumbo } from './utils/geo';

function App() {
  const [puntoPartida, setPuntoPartida] = useState(null);
  const [posicionActual, setPosicionActual] = useState(null);
  const [distancia, setDistancia] = useState(null);
  const [rumbo, setRumbo] = useState(null);
  const [errorGps, setErrorGps] = useState(null);
  const [modoCamara, setModoCamara] = useState(false);
  const [migajas, setMigajas] = useState([]);
  
  const [calibrado, setCalibrado] = useState(false);
  const [modoRetornoActivo, setModoRetornoActivo] = useState(false);
  const [indicadorVertical, setIndicadorVertical] = useState("NIVELADO");

  // FILTROS DE TELEMETRÍA DE ALTA PRECISIÓN
  const brujulaFiltrada = useRef(0);
  const betaFiltrado = useRef(0);
  const headingInteligente = useRef(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) { setPuntoPartida(JSON.parse(guardado)); setCalibrado(true); }
    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
  }, []);

  const registrarPuntoPartida = () => {
    if (!navigator.geolocation) { setErrorGps("Sin soporte GPS."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { 
          lat: pos.coords.latitude, 
          lon: pos.coords.longitude,
          alt: pos.coords.altitude || 0 
        };
        setPuntoPartida(coord);
        setMigajas([coord]);
        setCalibrado(true);
        localStorage.setItem('puntoPartida', JSON.stringify(coord));
        localStorage.setItem('migajas', JSON.stringify([coord]));
      },
      (err) => setErrorGps("Error GPS: " + err.message),
      { enableHighAccuracy: true }
    );
  };

  // CONTROL DE PASOS / DISTANCIA FILTRADA (Evita encimar puntos estáticos)
  useEffect(() => {
    if (!puntoPartida) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const actual = { 
          lat: pos.coords.latitude, 
          lon: pos.coords.longitude,
          alt: pos.coords.altitude || 0 
        };
        setPosicionActual(actual);

        const dist = calcularDistancia(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        const rum = calcularRumbo(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        
        setDistancia(dist.toFixed(3));
        setRumbo(rum);

        setMigajas((prevMigajas) => {
          const ultimaMigaja = prevMigajas[prevMigajas.length - 1];
          if (!ultimaMigaja) return prevMigajas;

          const distanciaDesdeUltimoHito = calcularDistancia(actual.lat, actual.lon, ultimaMigaja.lat, ultimaMigaja.lon);
          
          // FILTRO CRÍTICO: Solo guardamos hito si el usuario caminó más de 12 metros reales (0.012 Km)
          if (distanciaDesdeUltimoHito > 0.012) { 
            const nuevasMigajas = [...prevMigajas, { lat: actual.lat, lon: actual.lon, alt: actual.alt }];
            localStorage.setItem('migajas', JSON.stringify(nuevasMigajas));
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => setErrorGps("Error GPS: " + err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  // BRÚJULA ADAPTATIVA INTELIGENTE (Cambio Dinámico Parado v/s Acostado)
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let alpha = event.alpha || 0;
      let beta = event.beta || 0;
      let headingRaw = event.webkitCompassHeading || (360 - alpha);

      betaFiltrado.current += (beta - betaFiltrado.current) * 0.15;

      // CAMBIO DE EJE DINÁMICO: Si el teléfono está parado vertical (beta > 45) usamos alpha directo
      let headingCalculado = headingRaw;
      if (Math.abs(betaFiltrado.current) > 45) {
        headingCalculado = (360 - alpha) % 360; 
      }

      let diff = headingCalculado - brujulaFiltrada.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      brujulaFiltrada.current += diff * 0.15; // Suavizado anti-vibración
      headingInteligente.current = (brujulaFiltrada.current + 360) % 360;
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
        } catch (e) { setModoCamara(false); }
      } else {
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      }
    }
    activarCamara();
  }, [modoCamara]);

  // CANVAS EN VIVO (RA O MODAL DE RETORNO)
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 1 || !canvasRef.current || !modoRetornoActivo) {
      if(canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const loopRenderizado = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const indexPuntoObjetivo = migajas.length - 1;
      const puntoObjetivo = migajas[indexPuntoObjetivo];

      const rumboHito = calcularRumbo(posicionActual.lat, posicionActual.lon, puntoObjetivo.lat, puntoObjetivo.lon);
      const distHito = calcularDistancia(posicionActual.lat, posicionActual.lon, puntoObjetivo.lat, puntoObjetivo.lon);

      // Desnivel Vertical Cerros
      const deltaAltitudMetros = (puntoObjetivo.alt - posicionActual.alt);
      if (deltaAltitudMetros > 2.5) setIndicadorVertical("▲ SUBIR PENDIENTE");
      else if (deltaAltitudMetros < -2.5) setIndicadorVertical("▼ BAJAR A QUEBRADA");
      else setIndicadorVertical("NIVELADO");

      let diffAngulo = rumboHito - headingInteligente.current;
      diffAngulo = ((diffAngulo + 180) % 360) - 180;

      if (Math.abs(diffAngulo) < 60) {
        const hitoX = (canvas.width / 2) + (diffAngulo * (canvas.width / 75));
        const desfasajeAltitudPixeles = deltaAltitudMetros * 5; 
        const offsetInclinacionMano = (betaFiltrado.current - 45) * 4;
        const hitoY = (canvas.height * 0.5) - offsetInclinacionMano - desfasajeAltitudPixeles;

        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#FF5722';
        ctx.beginPath(); ctx.arc(hitoX, hitoY, 15, 0, 2 * Math.PI);
        ctx.fillStyle = '#FF5722'; ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText(indexPuntoObjetivo === 0 ? "BASE" : `HITO ${indexPuntoObjetivo}`, hitoX, hitoY - 25);
        ctx.font = '11px Arial'; ctx.fillStyle = '#FF5722';
        ctx.fillText(`${(distHito * 1000).toFixed(0)} metros`, hitoX, hitoY - 10);
        ctx.restore();
      }

      // Flecha de piso fija abajo
      const centroX = canvas.width / 2;
      const centroY = canvas.height * 0.82;
      ctx.save();
      ctx.translate(centroX, centroY);
      ctx.rotate((diffAngulo * Math.PI) / 180);
      ctx.lineWidth = 6; ctx.strokeStyle = '#2196F3'; ctx.fillStyle = 'rgba(33, 150, 243, 0.2)';
      ctx.shadowBlur = 15; ctx.shadowColor = '#2196F3';
      ctx.beginPath();
      ctx.moveTo(0, -60); ctx.lineTo(20, 15); ctx.lineTo(8, 8); ctx.lineTo(8, 40); ctx.lineTo(-8, 40); ctx.lineTo(-8, 8); ctx.lineTo(-20, 15);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    };

    const intervalo = setInterval(loopRenderizado, 30);
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, migajas, modoRetornoActivo]);

  // COMPARTIR RECORRIDO FIABLE (Mapeo Cartesiano Proporcional)
  const compartirRutaRedes = () => {
    if (migajas.length < 1) return;

    const shareCanvas = document.createElement('canvas');
    shareCanvas.width = 600; shareCanvas.height = 600;
    const sCtx = shareCanvas.getContext('2d');

    sCtx.fillStyle = '#141416'; sCtx.fillRect(0, 0, 600, 600);

    // Dibujo de Rejilla Base
    sCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)'; sCtx.lineWidth = 1;
    for (let i = 0; i < 600; i += 50) {
      sCtx.beginPath(); sCtx.moveTo(i, 0); sCtx.lineTo(i, 600); sCtx.stroke();
      sCtx.beginPath(); sCtx.moveTo(0, i); sCtx.lineTo(600, i); sCtx.stroke();
    }

    const lats = migajas.map(m => m.lat); const lons = migajas.map(m => m.lon);
    let maxLat = Math.max(...lats); let minLat = Math.min(...lats);
    let maxLon = Math.max(...lons); let minLon = Math.min(...lons);

    // Evitamos colapso matemático por línea recta perfecta
    if (maxLat === minLat) { maxLat += 0.0001; minLat -= 0.0001; }
    if (maxLon === minLon) { maxLon += 0.0001; minLon -= 0.0001; }

    const mapearPunto = (lat, lon) => {
      const pad = 110;
      const x = pad + ((lon - minLon) / (maxLon - minLon)) * (600 - pad * 2);
      const y = (600 - pad) - ((lat - minLat) / (maxLat - minLat)) * (600 - pad * 2);
      return { x, y };
    };

    // Trazado Neón
    sCtx.strokeStyle = '#00E5FF'; sCtx.lineWidth = 6; sCtx.lineCap = 'round'; sCtx.lineJoin = 'round';
    sCtx.shadowBlur = 12; sCtx.shadowColor = '#00E5FF';
    sCtx.beginPath();
    migajas.forEach((m, idx) => {
      const p = mapearPunto(m.lat, m.lon);
      if (idx === 0) sCtx.moveTo(p.x, p.y); else sCtx.lineTo(p.x, p.y);
    });
    sCtx.stroke();

    // Dibujo de Hitos circulares estables
    sCtx.shadowBlur = 0;
    migajas.forEach((m, idx) => {
      const p = mapearPunto(m.lat, m.lon);
      sCtx.beginPath(); sCtx.arc(p.x, p.y, idx === 0 ? 9 : 5, 0, 2 * Math.PI);
      sCtx.fillStyle = idx === 0 ? '#4CAF50' : '#00E5FF'; sCtx.fill();
    });

    // Textos informativos limpios
    sCtx.fillStyle = '#FFFFFF'; sCtx.font = 'bold 24px Arial'; sCtx.fillText("RECORRIDO SEGURO COMPLETADO 🏔️", 40, 55);
    
    let distAcumulada = 0;
    for(let i=1; i<migajas.length; i++) {
      distAcumulada += calcularDistancia(migajas[i-1].lat, migajas[i-1].lon, migajas[i].lat, migajas[i].lon);
    }
    sCtx.font = '14px Arial'; sCtx.fillStyle = '#A0A0A5';
    sCtx.fillText(`Distancia total caminada: ${(distAcumulada * 1000).toFixed(0)} metros`, 40, 90);
    sCtx.fillText(`Hitos de control verificados: ${migajas.length}`, 40, 110);

    // Zócalo Sponsors
    sCtx.fillStyle = 'rgba(255, 255, 255, 0.03)'; sCtx.fillRect(40, 510, 520, 60);
    sCtx.fillStyle = '#00E5FF'; sCtx.font = 'bold 10px Arial'; sCtx.fillText("SPONSORS:", 55, 532);
    sCtx.fillStyle = '#FFFFFF'; sCtx.font = 'italic 12px Arial'; sCtx.fillText("Casa de Deportes • Municipio Local • Agua Mineral de Montaña", 55, 552);

    const imageURI = shareCanvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.download = `Ruta_CerroSeguro_${Date.now()}.png`;
    link.href = imageURI; link.click();
  };

  // Cálculo de rumbo para la brújula HUD periférica de respaldo constante
  const rumboHaciaBaseCompleto = rumbo !== null ? (rumbo - headingInteligente.current) : 0;
  const listoParaCompartir = migajas.length >= 2;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh', position: 'relative' }}>
      
      {modoCamara && (
        <>
          <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
          <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: -1 }} />
        </>
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: '0 2px 4px black' }}>Retorno Cerro Seguro 🛰️</h1>

      {!calibrado ? (
        <div style={{ marginTop: '50px', backgroundColor: '#1E1E24', padding: '20px', borderRadius: '15px', border: '1px solid #333' }}>
          <h3 style={{ color: '#FF9800' }}>🔄 Calibración Activa</h3>
          <p style={{ fontSize: '14px', color: '#ccc' }}>Mueva el dispositivo en forma de <b>"8" en el aire</b> antes de marcar el inicio para orientar los sensores.</p>
          <button onClick={registrarPuntoPartida} style={{ padding: '16px 30px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', marginTop: '15px' }}>
            🟢 Presione para Iniciar Ruta
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => { setModoCamara(!modoCamara); setModoRetornoActivo(false); }} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.3)' }}>
            {modoCamara ? "🔋 Activar Modo Ahorro" : "📷 Vista Holográfica RA"}
          </button>

          {modoCamara && (
            <button onClick={() => setModoRetornoActivo(!modoRetornoActivo)} style={{ padding: '14px 28px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoRetornoActivo ? '#E91E63' : '#FF9800', color: 'white', border: 'none', borderRadius: '25px', display: 'block', margin: '10px auto' }}>
              {modoRetornoActivo ? "👁️ Modo Paisaje" : "🎯 Retornar al Hito Anterior"}
            </button>
          )}

          {listoParaCompartir && (
            <button onClick={compartirRutaRedes} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', display: 'block', margin: '10px auto' }}>
              🔥 Compartir Recorrido Realizado
            </button>
          )}

          {modoRetornoActivo && modoCamara && (
            <div style={{ position: 'fixed', top: '120px', left: '50%', transform: 'translateX(-50%)', backgroundColor: indicadorVertical === 'NIVELADO' ? 'rgba(76,175,80,0.95)' : 'rgba(233,30,99,0.95)', padding: '8px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px', color: 'white', zIndex: 10 }}>
              {indicadorVertical}
            </div>
          )}

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333', textShadow: 'none' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>📍 Hitos Limpios Guardados: {migajas.length}</span>
          </div>

          {/* BRÚJULA HUD COMPLETA: Siempre visible (en modo Ahorro o RA) e inteligente al cabeceo */}
          <div style={{ position: 'fixed', bottom: '30px', right: '30px', width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.85)', border: '2px solid #4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
            <div style={{ position: 'absolute', top: '4px', fontSize: '9px', color: '#4CAF50', fontWeight: 'bold' }}>N</div>
            <svg style={{ width: '45px', height: '45px', transform: `rotate(${rumboHaciaBaseCompleto}deg)`, fill: '#4CAF50', transition: 'transform 0.1s linear' }} viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>

          <br />
          <button onClick={() => { if(confirm("¿Borrar travesía?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); setCalibrado(false); setModoRetornoActivo(false); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '15px', fontSize: '11px', marginTop: '40px' }}>
            Reiniciar Todo
          </button>
        </div>
      )}
    </div>
  );
}

export default App;