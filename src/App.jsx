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

  // FILTROS DE TELEMETRÍA (Datos reales de tus sensores en montaña)
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
          // Nueva migaja cada 15 metros en el sendero
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
        
        brujulaFiltrada.current += diff * 0.15; // Amortiguación anti-shock
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

  // 6. INTERFAZ GRÁFICA MIXTA: FLECHA TÁCTICA + GOTAS DE ENERGÍA FLOTANTES
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 1 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const loopRenderizado = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- COMPONENTE 1: RENDERIZAR LAS ÚLTIMAS 4 GOTAS DE POSICIONAMIENTO ---
      // Tomamos solo las últimas migajas para no saturar al senderista
      const ultimasMigajas = migajas.slice(-4);
      
      ultimasMigajas.forEach((migaja, index) => {
        const rumboGotita = calcularRumbo(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);
        const distanciaGotita = calcularDistancia(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);

        let diffGotita = rumboGotita - brujulaFiltrada.current;
        diffGotita = ((diffGotita + 180) % 360) - 180;

        // Solo dibujamos la gota si cae dentro del rango visual frontal de la pantalla
        if (Math.abs(diffGotita) < 60) {
          const gotaX = (canvas.width / 2) + (diffGotita * (canvas.width / 80));
          
          const factorDist = Math.min(distanciaGotita, 0.1) / 0.1;
          const offsetInc = (betaFiltrado.current - 40) * 3;
          const gotaY = (canvas.height * 0.5) + (factorDist * (canvas.height * 0.35)) - offsetInc;

          // Tamaño de la gota decreciente según la antigüedad del punto
          const radioGota = (index + 1) * 3.5; 

          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#00E5FF';
          
          // Anillo Exterior Holográfico
          ctx.beginPath();
          ctx.arc(gotaX, gotaY, radioGota + 6, 0, 2 * Math.PI);
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Núcleo Sólido de la Gota
          ctx.beginPath();
          ctx.arc(gotaX, gotaY, radioGota, 0, 2 * Math.PI);
          ctx.fillStyle = '#00E5FF';
          ctx.fill();
          ctx.restore();
        }
      });

      // --- COMPONENTE 2: GRAN FLECHA CENTRAL EN EL SUELO ---
      const destinoUltimo = migajas[migajas.length - 1];
      const rumboHaciaAtras = calcularRumbo(posicionActual.lat, posicionActual.lon, destinoUltimo.lat, destinoUltimo.lon);
      const rotacionFlechaFinal = rumboHaciaAtras - brujulaFiltrada.current;

      const centroX = canvas.width / 2;
      const offsetInclinacion = (betaFiltrado.current - 40) * 3;
      const centroY = (canvas.height * 0.8) - offsetInclinacion;

      ctx.save();
      ctx.translate(centroX, centroY);
      ctx.rotate((rotacionFlechaFinal * Math.PI) / 180);

      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2196F3'; // Azul Eléctrico para diferenciarlo de las gotas
      ctx.fillStyle = 'rgba(33, 150, 243, 0.25)';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#2196F3';

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

  // --- COMPONENTE 3: MOTOR DE GENERACIÓN DE MAPA PARA COMPARTIR ---
  const compartirRutaRedes = () => {
    if (migajas.length < 2) return;

    // Crear un canvas oculto en memoria para renderizar la imagen táctica
    const shareCanvas = document.createElement('canvas');
    shareCanvas.width = 600;
    shareCanvas.height = 600;
    const sCtx = shareCanvas.getContext('2d');

    // Fondo Deportivo Tecnológico
    sCtx.fillStyle = '#121212';
    sCtx.fillRect(0, 0, shareCanvas.width, shareCanvas.height);

    // Rejilla de coordenadas de fondo (Estética Radar)
    sCtx.strokeStyle = 'rgba(255,255,255,0.03)';
    sCtx.lineWidth = 1;
    for(let i=0; i<600; i+=40) {
      sCtx.beginPath(); sCtx.moveTo(i, 0); sCtx.lineTo(i, 600); sCtx.stroke();
      sCtx.beginPath(); sCtx.moveTo(0, i); sCtx.lineTo(600, i); sCtx.stroke();
    }

    // Encontrar límites de la ruta para auto-centrar el mapa
    const lats = migajas.map(m => m.lat);
    const lons = migajas.map(m => m.lon);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    
    const mapPoint = (lat, lon) => {
      const padding = 100;
      const x = padding + ((lon - minLon) / (maxLon - minLon || 1)) * (600 - padding * 2);
      // Invertimos Y para que el norte quede arriba
      const y = (600 - padding) - ((lat - minLat) / (maxLat - minLat || 1)) * (600 - padding * 2);
      return { x, y };
    };

    // Dibujar el trazo del sendero realizado
    sCtx.strokeStyle = '#00E5FF';
    sCtx.lineWidth = 6;
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

    // Dibujar Base (Punto de Partida)
    const ptBase = mapPoint(migajas[0].lat, migajas[0].lon);
    sCtx.beginPath(); sCtx.arc(ptBase.x, ptBase.y, 10, 0, 2*Math.PI);
    sCtx.fillStyle = '#4CAF50'; sCtx.fill();

    // Textos Informativos de la Hazaña
    sCtx.shadowBlur = 0;
    sCtx.fillStyle = '#ffffff';
    sCtx.font = 'bold 24px Arial';
    sCtx.fillText("¡RETORNO SEGURO COMPLETADO! 🏔️", 40, 50);
    
    sCtx.font = '14px Arial';
    sCtx.fillStyle = '#888888';
    sCtx.fillText(`Distancia total recorrida: ${distancia || 0} Km`, 40, 80);
    sCtx.fillText(`Puntos de control verificados: ${migajas.length}`, 40, 100);

    // --- ZONA ESTRATÉGICA DE SPONSORS FUTUROS ---
    sCtx.fillStyle = 'rgba(255,255,255,0.05)';
    sCtx.fillRect(40, 510, 520, 60);
    sCtx.fillStyle = '#aaa';
    sCtx.font = 'italic italic 12px Arial';
    sCtx.fillText("Espacio para Sponsors: Casa de Deportes / Municipio / Agua Mineral", 120, 545);

    // Lanzar descarga directa de la imagen para compartir en Instagram/WhatsApp
    const imageURI = shareCanvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.download = `Mi_Ruta_Cerro_${Date.now()}.png`;
    link.href = imageURI;
    link.click();
  };

  const rotacionMiniBrujula = rumbo !== null ? (rumbo - brujulaFiltrada.current) : 0;
  const errorDireccion = ((rotacionMiniBrujula + 180) % 360) - 180;
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

  // El botón de redes aparece si estamos de vuelta cerca del origen (< 30 metros) y caminamos algo
  const listoParaCompartir = distancia !== null && parseFloat(distancia) < 0.03 && migajas.length > 3;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh', position: 'relative' }}>
      
      {modoCamara && (
        <>
          <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
          <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: -1 }} />
        </>
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: modoCamara ? '0 2px 4px black' : 'none' }}>Retorno Seguro RA 🛰️</h1>

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

          {/* GRAN BOTÓN SOCIAL REVELADO AL VOLVER A LA BASE */}
          {listoParaCompartir && (
            <button onClick={compartirRutaRedes} style={{ padding: '14px 28px', margin: '10px', fontSize: '15px', fontWeight: 'bold', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', boxShadow: '0 4px 15px rgba(255,152,0,0.5)', zIndex: 10, position: 'relative' }}>
              🔥 Compartir Mapa del Recorrido
            </button>
          )}

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>💧 Gotas en Ruta: {migajas.length}</span>
          </div>

          {estaDesviado && modoCamara && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', border: '12px solid rgba(255,107,107,0.5)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 5 }} />
          )}

          {/* BRÚJULA HUD FLOTANTE DE RESPALDO */}
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