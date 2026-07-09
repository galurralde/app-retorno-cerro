import { calcularDistancia, calcularRumbo } from './utils/geo';
import { useEffect, useRef, useState } from 'react';

function App() {
  const [puntoPartida, setPuntoPartida] = useState(null);
  const [posicionActual, setPosicionActual] = useState(null);
  const [distancia, setDistancia] = useState(null);
  const [rumbo, setRumbo] = useState(null);
  const [brujulaTelefono, setBrujulaTelefono] = useState(0);
  const [errorGps, setErrorGps] = useState(null);

  const [modoCamara, setModoCamara] = useState(false);
  const [migajas, setMigajas] = useState([]);
  
  // NUEVOS ESTADOS DE TELEMETRÍA PARA EL REGISTRO TXT
  const [logs, setLogs] = useState([]); // Historial de eventos en memoria
  const [aceleracion, setAceleracion] = useState({ x: 0, y: 0, z: 0 });
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // Función para registrar eventos con marca de tiempo
  const registrarLog = (tipo, detalle) => {
    const timestamp = new Date().toISOString();
    const nuevaLinea = `[${timestamp}] | ${tipo} | ${JSON.stringify(detalle)}`;
    setLogs((prev) => [...prev.slice(-300), nuevaLinea]); // Guardamos los últimos 300 eventos para no saturar
  };

  // 1. Cargar datos iniciales
  useEffect(() => {
    const guardado = localStorage.getItem('puntoPartida');
    if (guardado) setPuntoPartida(JSON.parse(guardado));

    const migajasGuardadas = localStorage.getItem('migajas');
    if (migajasGuardadas) setMigajas(JSON.parse(migajasGuardadas));
    
    registrarLog("SISTEMA", "Aplicación iniciada.");
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
        registrarLog("GPS_BASE", coord);
        alert("¡Base registrada!");
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true }
    );
  };

  // 3. Rastreo GPS y migajas
  useEffect(() => {
    if (!puntoPartida) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const actual = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude, prec: pos.coords.accuracy };
        setPosicionActual(actual);

        const dist = calcularDistancia(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        const rum = calcularRumbo(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        
        setDistancia(dist.toFixed(2));
        setRumbo(rum);

        registrarLog("GPS_TRACK", { dist: dist.toFixed(4), rum, alt: actual.alt, precision: actual.prec });

        setMigajas((prevMigajas) => {
          const ultimaMigaja = prevMigajas[prevMigajas.length - 1];
          if (!ultimaMigaja) return prevMigajas;

          const distALastMigaja = calcularDistancia(actual.lat, actual.lon, ultimaMigaja.lat, ultimaMigaja.lon);
          if (distALastMigaja > 0.02) {
            const nuevasMigajas = [...prevMigajas, { lat: actual.lat, lon: actual.lon }];
            localStorage.setItem('migajas', JSON.stringify(nuevasMigajas));
            registrarLog("MIGAJA_NUEVA", { total: nuevasMigajas.length });
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => {
        setErrorGps("Error de rastreo: " + err.message);
        registrarLog("ERROR_GPS", err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  // 4. Capturar Orientación (Brújula) y Acelerómetro (Movimientos Bruscos)
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let heading = event.webkitCompassHeading || (360 - event.alpha);
      if (heading) {
        setBrujulaTelefono(heading);
        // Registramos muestreos de brújula de forma intermitente para no saturar el log
        if (Math.random() < 0.05) {
          registrarLog("COMPASS_RAW", { heading: heading.toFixed(1), alpha: event.alpha?.toFixed(1), beta: event.beta?.toFixed(1), gamma: event.gamma?.toFixed(1) });
        }
      }
    };

    const manejarMovimiento = (event) => {
      const acc = event.accelerationIncludingGravity;
      if (acc) {
        setAceleracion({ x: acc.x || 0, y: acc.y || 0, z: acc.z || 0 });
        // Si detecta un impacto brusco (salto, tropiezo o corrida intensa), lo guarda de inmediato
        if (Math.abs(acc.x) > 15 || Math.abs(acc.y) > 15 || Math.abs(acc.z) > 15) {
          registrarLog("IMPACTO_DETECTADO", { x: acc.x.toFixed(2), y: acc.y.toFixed(2), z: acc.z.toFixed(2) });
        }
      }
    };

    window.addEventListener('deviceorientation', manejarOrientacion, true);
    window.addEventListener('devicemotion', manejarMovimiento, true);
    
    return () => {
      window.removeEventListener('deviceorientation', manejarOrientacion, true);
      window.removeEventListener('devicemotion', manejarMovimiento, true);
    };
  }, []);

  // 5. Control de la cámara física
  useEffect(() => {
    async function activarCamara() {
      if (modoCamara) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "environment" } }, audio: false });
          if (videoRef.current) { videoRef.current.srcObject = stream; streamRef.current = stream; }
          registrarLog("CAMERA", "Encendida");
        } catch (err) {
          try {
            const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (videoRef.current) { videoRef.current.srcObject = fallback; streamRef.current = fallback; }
          } catch (e) { setModoCamara(false); registrarLog("ERROR_CAMERA", err.message); }
        }
      } else {
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        registrarLog("CAMERA", "Apagada (Ahorro Energía)");
      }
    }
    activarCamara();
  }, [modoCamara]);

  // FUNCIÓN CLAVE: Descargar el archivo TXT con los datos matemáticos acumulados
  const descargarDiagnosticoTxt = () => {
    const contenido = logs.join('\n');
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `telemetria_cerro_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const rotacionFlecha = rumbo !== null ? (rumbo - brujulaTelefono) : 0;
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

      <h1 style={{ fontSize: '22px', color: '#4CAF50', margin: '5px 0', textShadow: modoCamara ? '0 2px 4px black' : 'none' }}>Laboratorio Táctico 🛰️</h1>

      {!puntoPartida ? (
        <div style={{ marginTop: '80px' }}>
          <button onClick={registrarPuntoPartida} style={{ padding: '18px 35px', fontSize: '18px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px' }}>
            Fijar Punto de Partida
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => setModoCamara(!modoCamara)} style={{ padding: '10px 20px', margin: '5px', fontSize: '13px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '20px' }}>
            {modoCamara ? "🔋 Modo Económico" : "📷 Modo Cámara"}
          </button>

          {/* BOTÓN MAGISTRAL DE TELEMETRÍA */}
          <button onClick={descargarDiagnosticoTxt} style={{ padding: '10px 20px', margin: '5px', fontSize: '13px', fontWeight: 'bold', backgroundColor: '#E91E63', color: 'white', border: 'none', borderRadius: '20px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(233,30,99,0.3)' }}>
            💾 Descargar Telemetría (.TXT)
          </button>

          {/* MONITOR TÁCTICO EN TIEMPO REAL */}
          <div style={{ backgroundColor: 'rgba(20,20,20,0.9)', padding: '12px', borderRadius: '10px', maxWidth: '280px', margin: '10px auto', border: '1px solid #333', textAlign: 'left', fontSize: '12px' }}>
            <p style={{ margin: '3px 0' }}><b>Distancia:</b> {distancia ? `${distancia} Km` : 'Buscando...'}</p>
            <p style={{ margin: '3px 0' }}><b>Rumbo Requerido:</b> {rumbo ? `${rumbo.toFixed(1)}°` : '---'}</p>
            <p style={{ margin: '3px 0' }}><b>Brújula Celular:</b> {brujulaTelefono.toFixed(1)}°</p>
            <p style={{ margin: '3px 0', color: '#00E5FF' }}><b>G-Force:</b> X:{aceleracion.x.toFixed(1)} Y:{aceleracion.y.toFixed(1)} Z:{aceleracion.z.toFixed(1)}</p>
            <p style={{ margin: '3px 0', color: '#4CAF50' }}><b>Buffer de Logs:</b> {logs.length} líneas guardadas</p>
          </div>

          {modoCamara && (
            <div style={{ position: 'fixed', bottom: '20px', right: '20px', width: '70px', height: '70px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.75)', border: estaDesviado ? '2px solid #ff6b6b' : '2px solid #4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg style={{ width: '35px', height: '35px', transform: `rotate(${rotacionFlecha}deg)`, fill: estaDesviado ? '#ff6b6b' : '#4CAF50' }} viewBox="0 0 24 24">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
              </svg>
            </div>
          )}

          <br />
          <button onClick={() => { if(confirm("¿Borrar ruta?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); setLogs([]); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '5px 10px', borderRadius: '15px', fontSize: '11px', marginTop: '10px' }}>
            Reiniciar Todo
          </button>
        </div>
      )}
    </div>
  );
}

export default App;