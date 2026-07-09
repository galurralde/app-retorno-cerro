import { calcularDistancia, calcularRumbo } from "./utils/geo";
import { useEffect, useState } from "react";

function App() {
  const [puntoPartida, setPuntoPartida] = useState(null);
  const [posicionActual, setPosicionActual] = useState(null);
  const [distancia, setDistancia] = useState(null);
  const [rumbo, setRumbo] = useState(null); // Ángulo hacia el destino
  const [brujulaTelefono, setBrujulaTelefono] = useState(0); // Ángulo físico del teléfono
  const [errorGps, setErrorGps] = useState(null);

  // 1. Guardar la ubicación base (Al pie del cerro)
  const registrarPuntoPartida = () => {
    if (!navigator.geolocation) {
      setErrorGps("Tu navegador no soporta GPS.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coord = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setPuntoPartida(coord);
        localStorage.setItem("puntoPartida", JSON.stringify(coord));
        alert("¡Punto de partida registrado! Ya puedes iniciar el ascenso.");
      },
      (err) => setErrorGps("Error al obtener ubicación: " + err.message),
      { enableHighAccuracy: true },
    );
  };

  // Cargar punto si ya existía en memoria local
  useEffect(() => {
    const guardado = localStorage.getItem("puntoPartida");
    if (guardado) setPuntoPartida(JSON.parse(guardado));
  }, []);

  // 2. Activar el rastreo GPS en tiempo real (Offline)
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
        setRumbo(rum); // Guardamos el número entero para la matemática de la flecha
      },
      (err) => setErrorGps("Error de rastreo: " + err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [puntoPartida]);

  // 3. Capturar la brújula física del dispositivo (Giroscopio/Magnetómetro)
  useEffect(() => {
    const manejarOrientacion = (event) => {
      // webkitCompassHeading es la propiedad estándar en iOS (Safari)
      // alpha es la propiedad en Android (Chrome), pero requiere calibración.
      let heading = event.webkitCompassHeading || 360 - event.alpha;
      if (heading) {
        setBrujulaTelefono(heading);
      }
    };

    // Solicitar permisos de orientación (necesario especialmente en iOS)
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((response) => {
          if (response === "granted") {
            window.addEventListener(
              "deviceorientation",
              manejarOrientacion,
              true,
            );
          }
        })
        .catch(console.error);
    } else {
      window.addEventListener("deviceorientation", manejarOrientacion, true);
    }

    return () =>
      window.removeEventListener("deviceorientation", manejarOrientacion, true);
  }, []);

  // 4. Calcular cuánto debe rotar la flecha visualmente
  const rotacionFlecha = rumbo !== null ? rumbo - brujulaTelefono : 0;

  // 5. ALGORITMO DE DESVÍO: ¿El usuario camina hacia el lado contrario?
  // Normalizamos el error de desvío entre -180 y 180 grados
  const errorDireccion = ((rotacionFlecha + 180) % 360) - 180;
  // Si el desvío es mayor a 45 grados (hacia la izquierda o derecha), está desviado
  const estaDesviado = rumbo !== null && Math.abs(errorDireccion) > 45;

  // Disparar vibración física en el teléfono si está desviado (Offline API)
  useEffect(() => {
    if (estaDesviado && navigator.vibrate) {
      // Vibra por 200ms, pausa 100ms, vibra 200ms (alerta de peligro)
      navigator.vibrate([200, 100, 200]);
    }
  }, [estaDesviado]);

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        backgroundColor: "#121212",
        color: "#e0e0e0",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "26px", color: "#4CAF50", marginBottom: "5px" }}>
        Retorno Seguro 🌲
      </h1>
      <p style={{ opacity: 0.7, fontSize: "14px" }}>
        Brújula táctica offline para senderismo
      </p>

      {errorGps && (
        <p
          style={{
            color: "#ff6b6b",
            backgroundColor: "#2c1a1a",
            padding: "10px",
            borderRadius: "5px",
          }}
        >
          ⚠️ {errorGps}
        </p>
      )}

      {!puntoPartida ? (
        <div style={{ marginTop: "60px" }}>
          <p style={{ fontSize: "16px", margin: "20px" }}>
            👉 Estás en la base del cerro. Registra tu posición actual antes de
            perder la señal.
          </p>
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
              boxShadow: "0 4px 15px rgba(76,175,80,0.3)",
              cursor: "pointer",
            }}
          >
            Fijar Punto de Partida
          </button>
        </div>
      ) : (
        <div style={{ marginTop: "20px" }}>
          {/* CONTENEDOR DISRUPTIVO: LA FLECHA INTERACTIVA */}
          <div
            style={{
              margin: "30px auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Círculo de la brújula adaptativo */}
            <div
              style={{
                width: "200px",
                height: "200px",
                borderRadius: "50%",
                border: estaDesviado
                  ? "3px solid #ff6b6b"
                  : "3px solid #2196F3", // Rojo si está desviado
                backgroundColor: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: estaDesviado
                  ? "0 0 30px rgba(255,107,107,0.4)"
                  : "0 0 25px rgba(33,150,243,0.2)",
                position: "relative",
                transition: "all 0.3s ease",
              }}
            >
              {/* Flecha SVG */}
              <svg
                style={{
                  width: "100px",
                  height: "100px",
                  transform: `rotate(${rotacionFlecha}deg)`,
                  transition: "transform 0.2s ease-out",
                  fill: estaDesviado
                    ? "#ff6b6b"
                    : distancia && distancia < 0.1
                      ? "#4CAF50"
                      : "#2196F3",
                }}
                viewBox="0 0 24 24"
              >
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
              </svg>

              <span
                style={{
                  position: "absolute",
                  top: "10px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  color: estaDesviado ? "#ff6b6b" : "#666",
                }}
              >
                {estaDesviado ? "⚠️ DESVIADO" : "NORTE APP"}
              </span>
            </div>

            {/* Datos de telemetría */}
            <div
              style={{
                marginTop: "20px",
                padding: "15px 30px",
                borderRadius: "15px",
                backgroundColor: "#1c1c1c",
                border: "1px solid #333",
                inlineSize: "280px",
              }}
            >
              <p style={{ margin: "5px 0", fontSize: "14px", color: "#aaa" }}>
                DISTANCIA AL ORIGEN
              </p>
              <p
                style={{
                  margin: "0",
                  fontSize: "32px",
                  fontWeight: "bold",
                  color: "#fff",
                }}
              >
                {distancia ? `${distancia} Km` : "Calculando..."}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (
                window.confirm("¿Seguro que quieres borrar la ruta actual?")
              ) {
                localStorage.clear();
                setPuntoPartida(null);
                setDistancia(null);
              }
            }}
            style={{
              backgroundColor: "transparent",
              color: "#ff6b6b",
              border: "1px solid #ff6b6b",
              padding: "8px 15px",
              borderRadius: "20px",
              cursor: "pointer",
              fontSize: "12px",
              marginTop: "20px",
            }}
          >
            Reiniciar Ruta
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
