import { calcularDistancia, calcularRumbo } from "./utils/geo";
import { useEffect, useRef, useState } from "react";

function App() {
  const [puntoPartida, setPuntoPartida] = useState(null);
  const [posicionActual, setPosicionActual] = useState(null);
  const [distancia, setDistancia] = useState(null);
  const [rumbo, setRumbo] = useState(null);
  const [brujulaTelefono, setBrujulaTelefono] = useState(0);
  const [errorGps, setErrorGps] = useState(null);

  const [modoCamara, setModoCamara] = useState(false);
  const [migajas, setMigajas] = useState([]);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  // 1. Cargar datos iniciales de LocalStorage
  useEffect(() => {
    const guardado = localStorage.getItem("puntoPartida");
    if (guardado) setPuntoPartida(JSON.parse(guardado));

    const migajasGuardadas = localStorage.getItem("migajas");
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
        localStorage.setItem("puntoPartida", JSON.stringify(coord));
        localStorage.setItem("migajas", JSON.stringify([coord]));
        alert("¡Base registrada y camino de migajas iniciado!");
      },
      (err) => setErrorGps("Error de GPS: " + err.message),
      { enableHighAccuracy: true },
    );
  };

  // 3. Rastreo GPS y guardar migajas cada 20 metros
  useEffect(() => {
    if (!puntoPartida) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const actual = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPosicionActual(actual);

        const dist = calcularDistancia(
          actual.lat,
          actual.lon,
          puntoPartida.lat,
          puntoPartida.lon,
        );
        const rum = calcularRumbo(
          actual.lat,
          actual.lon,
          puntoPartida.lat,
          puntoPartida.lon,
        );

        setDistancia(dist.toFixed(2));
        setRumbo(rum);

        setMigajas((prevMigajas) => {
          const ultimaMigaja = prevMigajas[prevMigajas.length - 1];
          if (!ultimaMigaja) return prevMigajas;

          const distALastMigaja = calcularDistancia(
            actual.lat,
            actual.lon,
            ultimaMigaja.lat,
            ultimaMigaja.lon,
          );
          if (distALastMigaja > 0.02) {
            // 20 metros
            const nuevasMigajas = [...prevMigajas, actual];
            localStorage.setItem("migajas", JSON.stringify(nuevasMigajas));
            return nuevasMigajas;
          }
          return prevMigajas;
        });
      },
      (err) => setErrorGps("Error de rastreo: " + err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntoPartida]);

  // 4. Capturar brújula física
  useEffect(() => {
    const manejarOrientacion = (event) => {
      let heading = event.webkitCompassHeading || 360 - event.alpha;
      if (heading) setBrujulaTelefono(heading);
    };
    window.addEventListener("deviceorientation", manejarOrientacion, true);
    return () =>
      window.removeEventListener("deviceorientation", manejarOrientacion, true);
  }, []);

  // 5. Control de encendido/apagado de cámara física (Corregido para ESLint)
  useEffect(() => {
    let activeStream = null;

    async function activarCamara() {
      if (!modoCamara) {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: "environment" } },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
          activeStream = stream;
        }
      } catch (err) {
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
          if (videoRef.current) {
            videoRef.current.srcObject = fallback;
            streamRef.current = fallback;
            activeStream = fallback;
          }
        } catch (e) {
          setErrorGps("No se abrió la cámara.");
          setModoCamara(false);
        }
      }
    }

    activarCamara();

    return () => {
      if (activeStream) activeStream.getTracks().forEach((t) => t.stop());
    };
  }, [modoCamara]); // Agregamos modoCamara aquí para resolver la advertencia de dependencias

// 6. RENDERIZADO DE LA LÍNEA DE RA (Proyección absoluta de 360° en el Suelo)
  useEffect(() => {
    if (!modoCamara || !posicionActual || migajas.length < 2 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Forzar resolución nativa de la pantalla del celular
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const dibujarCaminoRA = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Estilo de Neón Táctico
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#00E5FF'; // Celeste Neón Brillante
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 20;
      ctx.shadowColor = '#00E5FF';
      
      ctx.beginPath();
      let lineaIniciada = false;

// Recorremos TODAS las migajas del trayecto para unirlas con precisión
      for (let i = 0; i < migajas.length; i++) {
        const migaja = migajas[i];
        
        // Calcular la dirección real de la migaja
        const rumboMigaja = calcularRumbo(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);
        const distanciaMigaja = calcularDistancia(posicionActual.lat, posicionActual.lon, migaja.lat, migaja.lon);

        // Ángulo relativo entre el frente del teléfono y la migaja
        let diffAngulo = rumboMigaja - brujulaTelefono;
        diffAngulo = ((diffAngulo + 180) % 360) - 180; // Normalizar entre -180 y 180

        // PROYECCIÓN HORIZONTAL (Eje X)
        // Multiplicamos por un factor adecuado para mapear el ángulo al ancho de la pantalla
        const x = (canvas.width / 2) + (diffAngulo * (canvas.width / 60));
        
        // PROYECCIÓN DE PERSPECTIVA (Eje Y) - CALIBRACIÓN MEJORADA
        // Usamos una función exponencial inversa para que la distancia se note de forma fluida
        // Las migajas muy cercanas (0 km) se dibujarán abajo en la pantalla (cerca de tus pies)
        // Las lejanas subirán suavemente hacia el centro, simulando profundidad en el terreno.
        const maximaDistanciaGrafica = 0.15; // 150 metros como rango visible óptimo
        const proporcionDistancia = Math.min(distanciaMigaja, maximaDistanciaGrafica) / maximaDistanciaGrafica;
        
        // El camino ocupará desde el 85% de la altura (abajo) hasta el 50% (horizonte)
        const y = canvas.height - (proporcionDistancia * (canvas.height * 0.35)) - (canvas.height * 0.15);

        // Dibujar el trazo continuo uniendo los puntos
        if (!lineaIniciada) {
          ctx.moveTo(x, y);
          lineaIniciada = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    // Animación fluida loop
    const intervalo = setInterval(dibujarCaminoRA, 50);
    return () => clearInterval(intervalo);
  }, [modoCamara, posicionActual, brujulaTelefono, migajas]);

    

  // Telemetría y cálculos generales
  const rotacionFlecha = rumbo !== null ? rumbo - brujulaTelefono : 0;
  const errorDireccion = ((rotacionFlecha + 180) % 360) - 180;
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        backgroundColor: modoCamara ? "transparent" : "#121212",
        color: "#e0e0e0",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      {modoCamara && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              objectFit: "cover",
              zIndex: -2,
            }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              pointerEvents: "none",
              zIndex: -1,
            }}
          />
        </>
      )}

      <h1
        style={{
          fontSize: "24px",
          color: "#4CAF50",
          margin: "5px 0",
          textShadow: modoCamara ? "0 2px 4px black" : "none",
        }}
      >
        Retorno Seguro RA 🛰️
      </h1>

      {!puntoPartida ? (
        <div style={{ marginTop: "80px" }}>
          <button
            onClick={registrarPuntoPartida}
            style={{
              padding: "18px 35px",
              fontSize: "18px",
              fontWeight: "bold",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "30px",
              cursor: "pointer",
            }}
          >
            Fijar Punto de Partida
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={() => setModoCamara(!modoCamara)}
            style={{
              padding: "10px 20px",
              margin: "10px",
              fontSize: "14px",
              fontWeight: "bold",
              backgroundColor: modoCamara ? "#f44336" : "#2196F3",
              color: "white",
              border: "none",
              borderRadius: "20px",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            }}
          >
            {modoCamara
              ? "🔋 Activar Modo Económico"
              : "📷 Activar Visión RA (Camino)"}
          </button>

          <div
            style={{
              backgroundColor: "rgba(20,20,20,0.85)",
              padding: "10px",
              borderRadius: "10px",
              maxWidth: "240px",
              margin: "10px auto",
              border: "1px solid #333",
            }}
          >
            <span style={{ fontSize: "11px", color: "#aaa" }}>
              AL ORIGEN: <b>{distancia ? `${distancia} Km` : "Buscando..."}</b>
            </span>
            <br />
            <span style={{ fontSize: "11px", color: "#4CAF50" }}>
              👣 {migajas.length} puntos en el camino
            </span>
          </div>

          {!modoCamara && (
            <div
              style={{
                margin: "40px auto",
                width: "200px",
                height: "200px",
                borderRadius: "50%",
                border: estaDesviado
                  ? "3px solid #ff6b6b"
                  : "3px solid #2196F3",
                backgroundColor: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <svg
                style={{
                  width: "100px",
                  height: "100px",
                  transform: `rotate(${rotacionFlecha}deg)`,
                  fill: estaDesviado ? "#ff6b6b" : "#2196F3",
                }}
                viewBox="0 0 24 24"
              >
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
              </svg>
            </div>
          )}

          {modoCamara && (
            <div>
              {estaDesviado && (
                <div
                  style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    border: "10px solid rgba(255,107,107,0.6)",
                    boxSizing: "border-box",
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* MINI-BRÚJULA FLOTANTE INFERIOR DERECHA */}
              <div
                style={{
                  position: "fixed",
                  bottom: "20px",
                  right: "20px",
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  backgroundColor: "rgba(0,0,0,0.75)",
                  border: estaDesviado
                    ? "2px solid #ff6b6b"
                    : "2px solid #4CAF50",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  style={{
                    width: "40px",
                    height: "40px",
                    transform: `rotate(${rotacionFlecha}deg)`,
                    fill: estaDesviado ? "#ff6b6b" : "#4CAF50",
                  }}
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                </svg>
              </div>
            </div>
          )}

          <br />
          <button
            onClick={() => {
              if (confirm("¿Borrar ruta?")) {
                localStorage.clear();
                setPuntoPartida(null);
                setMigajas([]);
              }
            }}
            style={{
              backgroundColor: "rgba(0,0,0,0.6)",
              color: "#ff6b6b",
              border: "1px solid #ff6b6b",
              padding: "5px 10px",
              borderRadius: "15px",
              fontSize: "11px",
            }}
          >
            Reiniciar Todo
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
