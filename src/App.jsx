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

  // REFERENCIAS PARA EL FILTRO MATEMÁTICO LOW-PASS (Anti-vibración)
  const brujulaFiltrada = useRef(0);
  const betaFiltrado = useRef(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // 1. Cargar datos del almacenamiento local
  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) setPuntoPartida(JSON.parse(guardado));

    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
  }, []);

  // 2. Fijar base inicial
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
        alert("¡Base de retorno establecida!");
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true }
    );
  };

  // 3. Rastreo GPS dinámico inteligente
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
          // Si nos movimos más de 15 metros, dejamos una migaja física en el recorrido
          if (distALastMigaja > 0.015) {
            const nuevasMigajas = [...prevMigajas, { lat: actual.lat, lon: actual.lon }];
            localStorage.setItem('migajas', JSON.stringify(nuevasMigajas));
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => setErrorGps("Error de rastreo: " + err.message),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  // 4. Captura y Filtrado en Tiempo Real de Sensores (DeviceOrientation)
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let headingRaw = event.webkitCompassHeading || (360 - event.alpha);
      let betaRaw = event.beta || 0;

      if (headingRaw) {
        // FILTRO DE PASO BAJO (FACTOR 0.15): Absorbe el 85% del impacto violento del trote
        // Corrige el brinco matemático cuando la brújula cruza entre 360° y 0°
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

  // 5. Encendido/Apagado de la Cámara Física
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

  // 6. RENDERIZADO ESTABILIZADO ANTI-SHOCK (Camino de Retorno de Neón)
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 2 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const loopRenderizado = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Estilo de Sendero Táctico de Alta Visibilidad
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#00E5FF'; 
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#00E5FF';

      ctx.beginPath();
      let lineaIniciada = false;

      for (let i = 0; i < migajas.length; i++) {
        const migaja = migajas[i];
        
        const rumboMigaja = calcularRumbo(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);
        const distanciaMigaja = calcularDistancia(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);

        // Usamos la brújula suavizada por el filtro Low-pass
        let diffAngulo = rumboMigaja - brujulaFiltrada.current;
        diffAngulo = ((diffAngulo + 180) % 360) - 180;

        // Si el punto está dentro de un campo visual extendido, lo dibujamos
        if (Math.abs(diffAngulo) < 80) {
          // Mapeo X robusto
          const x = (canvas.width / 2) + (diffAngulo * (canvas.width / 90));
          
          // Mapeo Y Compensado por la inclinación física real del teléfono (betaFiltrado)
          // Esto evita que la línea se mueva arriba/abajo si estás subiendo o bajando pendientes
          const factorDistancia = Math.min(distanciaMigaja, 0.15) / 0.15; // Escala a 150 metros
          
          // Compensación por cabeceo del dispositivo
          const compensacionInclinacion = (betaFiltrado.current - 45) * 4; 
          const y = (canvas.height * 0.55) + (factorDistancia * (canvas.height * 0.35)) - compensacionInclinacion;

          if (!lineaIniciada) {
            ctx.moveTo(x, y);
            lineaIniciada = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.stroke();
    };

    const intervalo = setInterval(loopRenderizado, 30); // 33 FPS para fluidez total en carrera
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, migajas]);

  const rotacionFlecha = rumbo !== null ? (rumbo - brujulaFiltrada.current) : 0;
  const errorDireccion = ((rotacionFlecha + 180) % 360) - 180;
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh', position: 'relative' }}>
      
      {modoCamara && (
        <>
          <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
          <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: -1 }} />
        </>
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: modoCamara ? '0 2px 4px black' : 'none' }}>Retorno Cerro Seguro 🏔️</h1>

      {!puntoPartida ? (
        <div style={{ marginTop: '80px' }}>
          <button onClick={registrarPuntoPartida} style={{ padding: '18px 35px', fontSize: '18px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer' }}>
            Fijar Punto de Partida
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => setModoCamara(!modoCamara)} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
            {modoCamara ? "🔋 Activar Modo Ahorro" : "📷 Activar Vista de Camino RA"}
          </button>

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>DISTANCIA AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>📍 {migajas.length} Puntos de Ruta</span>
          </div>

          {estaDesviado && modoCamara && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', border: '12px solid rgba(255,107,107,0.5)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 5 }} />
          )}

          {/* BRÚJULA DINÁMICA DE RESPALDO */}
          <div style={{ position: 'fixed', bottom: '25px', right: '25px', width: '75px', height: '75px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.8)', border: estaDesviado ? '2px solid #ff6b6b' : '2px solid #4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <svg style={{ width: '40px', height: '40px', transform: `rotate(${rotacionFlecha}deg)`, fill: estaDesviado ? '#ff6b6b' : '#4CAF50', transition: 'transform 0.1s linear' }} viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>

          <br />
          <button onClick={() => { if(confirm("¿Deseas resetear la ruta actual?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '15px', fontSize: '11px', marginTop: '15px' }}>
            Reiniciar Trayecto
          </button>
        </div>
      )}
    </div>
  );
}

export default App;