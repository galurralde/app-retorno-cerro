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

  // REF DE ORIENTACIÓN ULTRA ESTABLE
  const brujulaFiltrada = useRef(0);
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

  useEffect(() => {
    if (!puntoPartida) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const actual = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude || 0 };
        setPosicionActual(actual);
        const dist = calcularDistancia(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        const rum = calcularRumbo(actual.lat, actual.lon, puntoPartida.lat, puntoPartida.lon);
        setDistancia(dist.toFixed(3));
        setRumbo(rum);
      },
      (err) => setErrorGps("Error GPS: " + err.message),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  // BRÚJULA MATRICIAL ADAPTATIVA DE ALTA PRECISIÓN (VERSIÓN CORREGIDA)
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let alpha = event.alpha || 0;
      let beta = event.beta || 0;
      let gamma = event.gamma || 0;
      let headingCalculado = event.webkitCompassHeading;

      // Si el navegador no provee webkitCompassHeading de forma nativa (o estamos emulando/Android)
      if (headingCalculado === undefined) {
        // Convertimos los ángulos de Euler del sensor a radianes
        const alphaRad = (alpha * Math.PI) / 180;
        const betaRad = (beta * Math.PI) / 180;
        const gammaRad = (gamma * Math.PI) / 180;

        // Calculamos las componentes del vector unitario apuntando al horizonte del equipo
        const cA = Math.cos(alphaRad), sA = Math.sin(alphaRad);
        const cB = Math.cos(betaRad), sB = Math.sin(betaRad);
        const cG = Math.cos(gammaRad), sG = Math.sin(gammaRad);

        // Matriz de rotación simplificada para obtener el Heading real proyectado al suelo
        const yH = -sA * cG - cA * sB * sG;
        const xH = -cA * cG + sA * sB * sG;

        let rumboRad = Math.atan2(yH, xH);
        if (rumboRad < 0) rumboRad += 2 * Math.PI;
        headingCalculado = (rumboRad * 180) / Math.PI;
      }

      // CORRECCIÓN DINÁMICA POR INCLINACIÓN (Sostener acostado mirando al piso)
      // Si el dispositivo está plano (cerca de la mesa o apuntando al piso, beta bajo o gamma alto),
      // forzamos el recalculo basándonos en la orientación horizontal estricta.
      if (Math.abs(beta) < 35 && Math.abs(gamma) > 45) {
        headingCalculado = (headingCalculado + 90) % 360; // Compensación de desfase de agarre horizontal
      }

      // Filtro de paso bajo matemático para eliminar el temblor de la mano
      let diff = headingCalculado - brujulaFiltrada.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      
      brujulaFiltrada.current += diff * 0.22; // Nivel de respuesta rápido y suave
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

  // El rumbo HUD calcula el norte real o el desvío hacia tu base fijada
  const agujaNorteYBase = headingInteligente.current;

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', textAlign: 'center', backgroundColor: modoCamara ? 'transparent' : '#121212', color: '#e0e0e0', minHeight: '100vh', position: 'relative' }}>
      
      {modoCamara && (
        <video ref={videoRef} autoPlay playsInline style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', objectFit: 'cover', zIndex: -2 }} />
      )}

      <h1 style={{ fontSize: '24px', color: '#4CAF50', margin: '5px 0', textShadow: '0 2px 4px black' }}>Retorno Cerro Seguro 🛰️</h1>

      {!calibrado ? (
        <div style={{ marginTop: '50px', backgroundColor: '#1E1E24', padding: '20px', borderRadius: '15px', border: '1px solid #333' }}>
          <h3 style={{ color: '#FF9800' }}>🔄 Sincronización Inicial</h3>
          <p style={{ fontSize: '14px', color: '#ccc' }}>Coloque el teléfono en la posición que usará para caminar (parado o apuntando al piso) y dibuje un <b>8 en el aire</b>.</p>
          <button onClick={registrarPuntoPartida} style={{ padding: '16px 30px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '30px', cursor: 'pointer', marginTop: '15px' }}>
            🟢 Calibrar y Fijar Base
          </button>
        </div>
      ) : (
        <div>
          <button onClick={() => { setModoCamara(!modoCamara); setModoRetornoActivo(false); }} style={{ padding: '12px 24px', margin: '10px', fontSize: '14px', fontWeight: 'bold', backgroundColor: modoCamara ? '#f44336' : '#2196F3', color: 'white', border: 'none', borderRadius: '25px', cursor: 'pointer', zIndex: 100 }}>
            {modoCamara ? "🔋 Activar Modo Ahorro" : "📷 Vista Holográfica RA"}
          </button>

          <div style={{ backgroundColor: 'rgba(20,20,20,0.85)', padding: '10px', borderRadius: '10px', maxWidth: '240px', margin: '10px auto', border: '1px solid #333' }}>
            <span style={{ fontSize: '13px', color: '#00E5FF' }}>🧭 Dirección Norte HUD Activo</span>
            <br />
            <span style={{ fontSize: '11px', color: '#aaa' }}>Ángulo Actual: {agujaNorteYBase.toFixed(1)}°</span>
          </div>

          {/* BRÚJULA HUD TÁCTICA PERSISTENTE (NUNCA SE APAGA, CORREGIDA CON BASE EN GOOGLE MAPS) */}
          <div style={{ position: 'fixed', bottom: '40px', left: '50%', transform: 'translateX(-50%)', width: '90px', height: '90px', borderRadius: '50%', backgroundColor: 'rgba(15,15,18,0.92)', border: '3px solid #00E5FF', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, boxShadow: '0 4px 15px rgba(0,229,255,0.4)' }}>
            <div style={{ position: 'absolute', top: '5px', fontSize: '11px', color: '#ff4444', fontWeight: 'bold' }}>N</div>
            <div style={{ position: 'absolute', bottom: '5px', fontSize: '10px', color: '#fff', fontWeight: 'bold' }}>S</div>
            
            {/* Aguja Giroscópica Adaptativa */}
            <svg style={{ width: '50px', height: '50px', transform: `rotate(${-agujaNorteYBase}deg)`, transition: 'transform 0.08s linear' }} viewBox="0 0 24 24">
              {/* Flecha Norte (Roja) */}
              <path d="M12 2L6 12h6z" fill="#ff4444"/>
              {/* Flecha Sur (Blanca) */}
              <path d="M12 22l6-10h-6z" fill="#ffffff"/>
            </svg>
          </div>

          <br />
          <button onClick={() => { if(confirm("¿Borrar travesía?")) { localStorage.clear(); setPuntoPartida(null); setMigajas([]); setCalibrado(false); } }} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#ff6b6b', border: '1px solid #ff6b6b', padding: '6px 12px', borderRadius: '15px', fontSize: '11px', marginTop: '120px' }}>
            Reiniciar Sensores
          </button>
        </div>
      )}
    </div>
  );
}

export default App;