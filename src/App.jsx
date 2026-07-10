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
  
  // NUEVOS ESTADOS DE CONTROL PROPUSTOS
  const [calibrado, setCalibrado] = useState(false);
  const [modoRetornoActivo, setModoRetornoActivo] = useState(false);
  const [indicadorVertical, setIndicadorVertical] = useState("NIVELADO"); // SUBIR, BAJAR o NIVELADO

  const brujulaFiltrada = useRef(0);
  const betaFiltrado = useRef(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) { setPuntoPartida(JSON.parse(guardado)); setCalibrado(true); }
    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
  }, []);

  // REGISTRO DE BASE CON CAPTURA DE ALTITUD REAL EN METROS
  const registrarPuntoPartida = () => {
    if (!navigator.geolocation) { setErrorGps("Sin soporte GPS."); return; }
    
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { 
          lat: pos.coords.latitude, 
          lon: pos.coords.longitude,
          alt: pos.coords.altitude || 0 // Capturamos la altura en el relieve del cerro
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

  // SEGUIMIENTO DE RUTA: GUARDA LAT, LON Y ALTITUD CADA 15 METROS
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

          const distALastMigaja = calcularDistancia(actual.lat, actual.lon, ultimaMigaja.lat, ultimaMigaja.lon);
          if (distALastMigaja > 0.015) { 
            const nuevasMigajas = [...prevMigajas, { lat: actual.lat, lon: actual.lon, alt: actual.alt }];
            localStorage.setItem('migajas', JSON.stringify(nuevasMigajas));
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => setErrorGps("Error GPS: " + err.message),
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
        } catch (e) { setModoCamara(false); }
      } else {
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      }
    }
    activarCamara();
  }, [modoCamara]);

  // RENDERIZADO RA TÁCTICO CON DETECCIÓN CLAVE DE DESNIVEL (CERRO V/S QUEBRADA)
  useEffect(() => {
    // Si el modo de retorno no está presionado, el canvas se mantiene limpio para ver el paisaje
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

      // Enfocamos únicamente el hito inmediatamente anterior (Retorno decreciente estricto)
      const indexPuntoObjetivo = migajas.length - 1;
      const puntoObjetivo = migajas[indexPuntoObjetivo];

      const rumboHito = calcularRumbo(posicionActual.lat, posicionActual.lon, puntoObjetivo.lat, puntoObjetivo.lon);
      const distHito = calcularDistancia(posicionActual.lat, posicionActual.lon, puntoObjetivo.lat, puntoObjetivo.lon);

      // --- CÁLCULO MÁGICO DE ALTITUD EN MONTAÑA ---
      const deltaAltitudMetros = (puntoObjetivo.alt - posicionActual.alt);
      
      // Si hay una diferencia de más de 3 metros de altura, disparamos alertas de inclinación
      if (deltaAltitudMetros > 3) {
        setIndicadorVertical("▲ SUBIR CERRO");
      } else if (deltaAltitudMetros < -3) {
        setIndicadorVertical("▼ BAJAR A QUEBRADA");
      } else {
        setIndicadorVertical("NIVELADO");
      }

      // --- PROYECCIÓN HOLOGRÁFICA EN PANTALLA ---
      let diffAngulo = rumboHito - brujulaFiltrada.current;
      diffAngulo = ((diffAngulo + 180) % 360) - 180;

      if (Math.abs(diffAngulo) < 60) {
        const hitoX = (canvas.width / 2) + (diffAngulo * (canvas.width / 75));
        
        // El punto se desplaza hacia el cielo o hacia el piso en base a la altitud real del GPS
        const desfasajeAltitudPixeles = deltaAltitudMetros * 4; 
        const factorDist = Math.min(distHito, 0.08) / 0.08;
        const offsetInclinacionMano = (betaFiltrado.current - 45) * 4;
        
        // Combinamos la altura de los ojos (centro de pantalla) + el relieve geográfico real
        const hitoY = (canvas.height * 0.5) - offsetInclinacionMano - desfasajeAltitudPixeles;

        // Dibujo del Hito Objetivo flotante con su etiqueta
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#FF5722'; // Naranja de alta visibilidad para el objetivo activo
        
        ctx.beginPath();
        ctx.arc(hitoX, hitoY, 15, 0, 2 * Math.PI);
        ctx.fillStyle = '#FF5722';
        ctx.fill();
        
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(indexPuntoObjetivo === 0 ? "BASE" : `HITO RETORNO ${indexPuntoObjetivo}`, hitoX, hitoY - 25);
        ctx.font = '11px Arial';
        ctx.fillStyle = '#FF5722';
        ctx.fillText(`${(distHito * 1000).toFixed(0)} m de dist`, hitoX, hitoY - 10);
        ctx.restore();
      }

      // --- DIBUJAR LA FLECHA AZUL ABAJO ---
      const centroX = canvas.width / 2;
      const centroY = canvas.height * 0.82;

      ctx.save();
      ctx.translate(centroX, centroY);
      ctx.rotate((diffAngulo * Math.PI) / 180);

      ctx.lineWidth = 6;
      ctx.strokeStyle = '#2196F3';
      ctx.fillStyle = 'rgba(33, 150, 243, 0.2)';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#2196F3';

      ctx.beginPath();
      ctx.moveTo(0, -60);
      ctx.lineTo(20, 15);
      ctx.lineTo(8, 8);
      ctx.lineTo(8, 40);
      ctx.lineTo(-8, 40);
      ctx.lineTo(-8, 8);
      ctx.lineTo(-20, 15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    const intervalo = setInterval(loopRenderizado, 30);
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, migajas, modoRetornoActivo]);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh' }}>
      
      {modoCamara && (
        <>
          <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
          <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: -1 }} />
        </>
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: '0 2px 4px black' }}>Retorno Seguro RA 🛰️</h1>

      {/* PASO 1: CALIBRACIÓN INICIAL PROPUESTA */}
      {!calibrado ? (
        <div style={{ marginTop: '50px', backgroundColor: '#1E1E24', padding: '20px', borderRadius: '15px', border: '1px solid #333' }}>
          <h3 style={{ color: '#FF9800' }}>🔄 Calibración Requerida</h3>
          <p style={{ fontSize: '14px', color: '#ccc' }}>Mueva el dispositivo dibujando un <b>"8" en el aire</b> para estabilizar los sensores magnéticos de montaña de su teléfono.</p>
          <button onClick={registrarPuntoPartida} style={{ padding: '16px 30px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', marginTop: '15px' }}>
            📍 Marcar Base de Inicio
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => { setModoCamara(!modoCamara); setModoRetornoActivo(false); }} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '25px' }}>
            {modoCamara ? "🔋 Modo Ahorro" : "📷 Encender Cámara"}
          </button>

          {/* PASO 2: BOTÓN EXCLUSIVO PARA ACTIVAR EL RETORNO DE HITO */}
          {modoCamara && (
            <button onClick={() => setModoRetornoActivo(!modoRetornoActivo)} style={{ padding: '14px 28px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoRetornoActivo ? '#E91E63' : '#FF9800', color: 'white', border: 'none', borderRadius: '25px', display: 'block', margin: '10px auto', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
              {modoRetornoActivo ? "👁️ Ver Paisaje Limpio" : "🎯 Retornar al Hito Anterior"}
            </button>
          )}

          {/* INDICADOR EXCLUSIVO DE PENDIENTE VERTICAL (CERRO / QUEBRADA) */}
          {modoRetornoActivo && modoCamara && (
            <div style={{ position: 'fixed', top: '120px', left: '50%', transform: 'translateX(-50%)', backgroundColor: indicadorVertical === 'NIVELADO' ? 'rgba(76,175,80,0.9)' : 'rgba(233,30,99,0.9)', padding: '8px 20px', borderRadius: '20px', fontWeight: 'bold', fontSize: '15px', color: 'white', zIndex: 10, boxShadow: '0 2px 8px black' }}>
              {indicadorVertical === 'NIVELADO' ? "• SENDERO AL MISMO NIVEL" : indicadorVertical}
            </div>
          )}

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>👣 Total Hitos Guardados: {migajas.length}</span>
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