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

  // FILTROS LOW-PASS ANTI-VIBRACIÓN (Datos de tu telemetría)
  const brujulaFiltrada = useRef(0);
  const betaFiltrado = useRef(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // 1. Cargar almacenamiento local
  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) setPuntoPartida(JSON.parse(guardado));

    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
  }, []);

  // 2. Registrar Base
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
        alert("¡Punto de retorno fijado con éxito!");
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true }
    );
  };

  // 3. Rastreo GPS (Deja migajas cada 15 metros)
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

  // 4. Captura y amortiguación de sensores
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let headingRaw = event.webkitCompassHeading || (360 - event.alpha);
      let betaRaw = event.beta || 0;

      if (headingRaw) {
        let diff = headingRaw - brujulaFiltrada.current;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        
        brujulaFiltrada.current += diff * 0.15; // Suaviza la brújula
        betaFiltrado.current += (betaRaw - betaFiltrado.current) * 0.15; // Suaviza el cabeceo
      }
    };

    window.addEventListener('deviceorientation', manejarOrientacion, true);
    return () => window.removeEventListener('deviceorientation', manejarOrientacion, true);
  }, []);

  // 5. Control de Cámara
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

  // 6. RENDERIZADO DE LA FLECHA RA DE ALTA MONTAÑA
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 1 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const loopRenderizado = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Tomamos la última migaja guardada para saber a dónde regresar inmediatamente
      const destinoUltimo = migajas[migajas.length - 1];
      const rumboHaciaAtras = calcularRumbo(posicionActual.lat, posicionActual.lon, destinoUltimo.lat, destinoUltimo.lon);

      // Calculamos el ángulo relativo entre el frente de tus ojos y el objetivo de retorno
      const rotacionFlechaFinal = rumboHaciaAtras - brujulaFiltrada.current;

      // Posicionamos el pivote de la flecha abajo en el centro de la pantalla (zona de pisada)
      const centroX = canvas.width / 2;
      
      // Ajuste dinámico de altura en pantalla según inclines el teléfono (beta)
      const offsetInclinacion = (betaFiltrado.current - 40) * 3;
      const centroY = (canvas.height * 0.75) - offsetInclinacion;

      ctx.save();
      ctx.translate(centroX, centroY);
      ctx.rotate((rotacionFlechaFinal * Math.PI) / 180);

      // Estilo Estilo Neón Cibernético de Alta Visibilidad
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#00E5FF'; // Celeste Neón Brillante
      ctx.fillStyle = 'rgba(0, 229, 255, 0.25)'; // Relleno translúcido
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#00E5FF';

      // Dibujo de Flecha Táctica en Perspectiva 3D apuntando al frente
      ctx.beginPath();
      ctx.moveTo(0, -70);    // Punta de la flecha
      ctx.lineTo(30, 15);    // Ala derecha exterior
      ctx.lineTo(12, 8);     // Quiebre interior derecho
      ctx.lineTo(12, 50);    // Base derecha
      ctx.lineTo(-12, 50);   // Base izquierda
      ctx.lineTo(-12, 8);    // Quiebre interior izquierdo
      ctx.lineTo(-30, 15);   // Ala izquierda exterior
      ctx.closePath();
      
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Anillo de horizonte de radar alrededor de la flecha
      ctx.beginPath();
      ctx.arc(centroX, centroY, 55, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 0;
      ctx.stroke();
    };

    const intervalo = setInterval(loopRenderizado, 30);
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, migajas]);

  const rotacionMiniBrujula = rumbo !== null ? (rumbo - brujulaFiltrada.current) : 0;
  const errorDireccion = ((rotacionMiniBrujula + 180) % 360) - 180;
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

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
            {modoCamara ? "🔋 Activar Modo Económico" : "📷 Activar Navegación RA"}
          </button>

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '12px', color: '#aaa' }}>AL ORIGEN: <b>{distancia ? `${distancia} Km` : 'Calculando...'}</b></span>
            <br />
            <span style={{ fontSize: '12px', color: '#00E5FF' }}>👣 {migajas.length} puntos registrados</span>
          </div>

          {estaDesviado && modoCamara && (
            <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', border: '12px solid rgba(255,107,107,0.5)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 5 }} />
          )}

          {/* MINI-BRÚJULA FLOTANTE DE RESPALDO INTERFAZ */}
          <div style={{ position: 'fixed', bottom: '25px', right: '25px', width: '75px', height: '75px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.8)', border: estaDesviado ? '2px solid #ff6b6b' : '2px solid #4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <svg style={{ width: '40px', height: '40px', transform: `rotate(${rotacionMiniBrujula}deg)`, fill: estaDesviado ? '#ff6b6b' : '#4CAF50' }} viewBox="0 0 24 24">
              <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
            </svg>
          </div>

          <br />
          <button onClick={() => { if(confirm("¿Borrar ruta?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '15px', fontSize: '11px', marginTop: '20px' }}>
            Reiniciar Todo
          </button>
        </div>
      )}
    </div>
  );
}

export default App;