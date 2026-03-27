import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Headphones, Activity, Volume2, SlidersHorizontal, AlertTriangle, Brain } from 'lucide-react';

const App = () => {
  // --- ESTADO DE LA INTERFAZ Y PROTOCOLO ---
  const [headphonesAcknowledged, setHeadphonesAcknowledged] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // en segundos
  const timerRef = useRef(null);

  // --- ESTADO DEL MOTOR DE AUDIO ---
  const [masterVol, setMasterVol] = useState(0.5);
  const [binauralVol, setBinauralVol] = useState(0.6);
  const [brownVol, setBrownVol] = useState(0.4);
  const [carrierFreq, setCarrierFreq] = useState(200); // Rango: 100 - 500 Hz
  const [beatFreq, setBeatFreq] = useState(15); // Rango: 1 - 30 Hz (Default: 15Hz Beta)

  // --- REFERENCIAS DE WEB AUDIO API ---
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const binauralGainRef = useRef(null);
  const brownGainRef = useRef(null);
  const oscLeftRef = useRef(null);
  const oscRightRef = useRef(null);
  const brownSourceRef = useRef(null);
  const brownFilterRef = useRef(null);

  // --- GENERACIÓN ALGORÍTMICA DE RUIDO MARRÓN ---
  const createBrownNoiseBuffer = (ctx) => {
    const bufferSize = ctx.sampleRate * 2; // 2 segundos de buffer (se repetirá en bucle)
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    
    // Algoritmo de aproximación a ruido marrón (integración de ruido blanco)
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Compensación de ganancia estructural
    }
    return noiseBuffer;
  };

  // --- INICIALIZACIÓN Y CICLO DE VIDA DEL AUDIO ---
  const initAudioEngine = useCallback(() => {
    // Instanciar el contexto solo bajo interacción del usuario (política de navegadores)
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }

    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    // 1. Configuración de Nodos de Ganancia
    masterGainRef.current = ctx.createGain();
    binauralGainRef.current = ctx.createGain();
    brownGainRef.current = ctx.createGain();

    masterGainRef.current.connect(ctx.destination);
    binauralGainRef.current.connect(masterGainRef.current);
    brownGainRef.current.connect(masterGainRef.current);

    // Ajuste inicial de volúmenes con rampa para evitar "clicks" (Zero-crossing)
    masterGainRef.current.gain.setValueAtTime(0, ctx.currentTime);
    masterGainRef.current.gain.linearRampToValueAtTime(masterVol, ctx.currentTime + 0.1);
    binauralGainRef.current.gain.value = binauralVol;
    brownGainRef.current.gain.value = brownVol;

    // 2. Sintetizador Binaural (Osciladores Independientes + Paneo Estricto)
    oscLeftRef.current = ctx.createOscillator();
    oscRightRef.current = ctx.createOscillator();
    const pannerLeft = ctx.createStereoPanner();
    const pannerRight = ctx.createStereoPanner();

    oscLeftRef.current.type = 'sine';
    oscRightRef.current.type = 'sine';
    
    // Asignación de frecuencias (Oído Izquierdo: Portadora / Oído Derecho: Portadora + Diferencia)
    oscLeftRef.current.frequency.value = carrierFreq;
    oscRightRef.current.frequency.value = carrierFreq + beatFreq;

    // Paneo 100% Izquierda y Derecha requerido por las leyes del pulso binaural
    pannerLeft.pan.value = -1;
    pannerRight.pan.value = 1;

    oscLeftRef.current.connect(pannerLeft);
    pannerLeft.connect(binauralGainRef.current);
    oscRightRef.current.connect(pannerRight);
    pannerRight.connect(binauralGainRef.current);

    oscLeftRef.current.start();
    oscRightRef.current.start();

    // 3. Generador de Ruido Marrón + Filtro Pasa-Bajos (Resonancia Estocástica)
    brownSourceRef.current = ctx.createBufferSource();
    brownSourceRef.current.buffer = createBrownNoiseBuffer(ctx);
    brownSourceRef.current.loop = true;

    brownFilterRef.current = ctx.createBiquadFilter();
    brownFilterRef.current.type = 'lowpass';
    brownFilterRef.current.frequency.value = 1000; // Especificación: Filtro ~1000Hz para la manta acústica

    brownSourceRef.current.connect(brownFilterRef.current);
    brownFilterRef.current.connect(brownGainRef.current);
    
    brownSourceRef.current.start();
  }, [carrierFreq, beatFreq, masterVol, binauralVol, brownVol]);

  // --- LIMPIEZA Y LIBERACIÓN DE RECURSOS ---
  const stopAudioEngine = useCallback(() => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;

    // Rampa de bajada suave para evitar artefactos sonoros al detener
    if (masterGainRef.current) {
      masterGainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    }

    // Desmontar nodos tras el desvanecimiento para prevenir Memory Leaks
    setTimeout(() => {
      if (oscLeftRef.current) {
        oscLeftRef.current.stop();
        oscLeftRef.current.disconnect();
        oscLeftRef.current = null;
      }
      if (oscRightRef.current) {
        oscRightRef.current.stop();
        oscRightRef.current.disconnect();
        oscRightRef.current = null;
      }
      if (brownSourceRef.current) {
        brownSourceRef.current.stop();
        brownSourceRef.current.disconnect();
        brownSourceRef.current = null;
      }
      if (ctx.state === 'running') {
        ctx.suspend(); // Se suspende en lugar de cerrar para permitir reinicios rápidos en la misma sesión
      }
    }, 100);
  }, []);

  // --- GESTIÓN DE EVENTOS DE REPRODUCCIÓN ---
  const togglePlay = () => {
    if (isPlaying) {
      // Corte Abrupto (Protocolo Pavloviano: Si se pierde el foco, se detiene el anclaje)
      setIsPlaying(false);
      clearInterval(timerRef.current);
      setElapsedTime(0); // Reinicia el temporizador de sesión
      stopAudioEngine();
    } else {
      setIsPlaying(true);
      initAudioEngine();
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }
  };

  // --- ACTUALIZACIÓN EN TIEMPO REAL DE PARÁMETROS (Sin reiniciar nodos) ---
  useEffect(() => {
    if (isPlaying && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      // Actualización de frecuencias
      if (oscLeftRef.current) oscLeftRef.current.frequency.setTargetAtTime(carrierFreq, ctx.currentTime, 0.1);
      if (oscRightRef.current) oscRightRef.current.frequency.setTargetAtTime(carrierFreq + beatFreq, ctx.currentTime, 0.1);
      // Actualización de volúmenes
      if (masterGainRef.current) masterGainRef.current.gain.setTargetAtTime(masterVol, ctx.currentTime, 0.1);
      if (binauralGainRef.current) binauralGainRef.current.gain.setTargetAtTime(binauralVol, ctx.currentTime, 0.1);
      if (brownGainRef.current) brownGainRef.current.gain.setTargetAtTime(brownVol, ctx.currentTime, 0.1);
    }
  }, [carrierFreq, beatFreq, masterVol, binauralVol, brownVol, isPlaying]);

  // Limpieza general on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      stopAudioEngine();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close(); // Liberación absoluta a nivel de navegador
      }
    };
  }, [stopAudioEngine]);

  // --- LÓGICA DE INTERFAZ (UI/UX) ---
  
  // Fase crítica de 15 minutos (900 segundos) para transición DMN a TPN
  const isFrictionPhase = elapsedTime < 900; 
  const phaseText = isFrictionPhase ? "Fase de Fricción / Supresión DMN" : "Estado de Flujo (TPN Activa)";
  const phaseColor = isFrictionPhase ? "text-neutral-400" : "text-emerald-500";
  const progressPercentage = Math.min((elapsedTime / 900) * 100, 100);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // --- ANÁLISIS COGNITIVO DERIVADO ---
  const getCognitiveAnalysis = () => {
    const analysis = {
      binaural: "",
      masking: "",
      protocol: isPlaying ? (isFrictionPhase ? "Resistencia metabólica activa. Mantén el estímulo para forzar la inhibición de la DMN." : "Hábito neurológico consolidado en esta sesión. DMN suprimida.") : "Sistema inactivo. Ausencia de estímulo condicionado."
    };

    // Análisis del rango de frecuencia binaural
    if (binauralVol === 0) {
      analysis.binaural = "Estímulo binaural anulado. Dependencia exclusiva del enmascaramiento de ruido.";
    } else if (beatFreq < 4) {
      analysis.binaural = "Rango Delta. Induce somnolencia. Contraproducente para trabajo activo y supresión de DMN.";
    } else if (beatFreq >= 4 && beatFreq <= 8) {
      analysis.binaural = "Rango Theta. Estado hipnagógico/relajación. Riesgo de pérdida de foco en tareas analíticas.";
    } else if (beatFreq > 8 && beatFreq <= 13) {
      analysis.binaural = "Rango Alfa. Vigilia relajada. Adecuado para tareas de baja carga cognitiva o recuperación.";
    } else {
      analysis.binaural = "Rango Beta. Óptimo para atención sostenida y alerta. Facilitador de la Red TPN.";
    }

    // Análisis del enmascaramiento acústico (Ruido Marrón)
    if (brownVol === 0) {
      analysis.masking = "Sin enmascaramiento. Alta vulnerabilidad a picos acústicos externos (secuestro atencional por la amígdala).";
    } else if (brownVol > 0 && brownVol < 0.4) {
      analysis.masking = "Enmascaramiento leve. Resonancia estocástica mínima. Útil solo en entornos inherentemente silenciosos.";
    } else {
      analysis.masking = "Enmascaramiento robusto. Óptima prevención de interrupciones sonoras y alta resonancia estocástica.";
    }

    return analysis;
  };

  const currentAnalysis = getCognitiveAnalysis();

  // Pantalla de Bloqueo / Advertencia de Hardware
  if (!headphonesAcknowledged) {
    return (
      <div className="flex-center min-h-screen p-4">
        <div className="rack-card max-w-md w-full text-center">
          <div className="flex-center mb-8">
            <div style={{ padding: '20px', borderRadius: '50%', background: 'rgba(0, 245, 155, 0.05)', border: '1px border var(--border-color)' }}>
              <Headphones className="w-12 h-12" style={{ color: 'var(--accent-color)' }} />
            </div>
          </div>
          <h1 className="mb-4" style={{ fontSize: '24px', fontWeight: '700', letterSpacing: '-0.5px' }}>Requisito de Hardware</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '32px' }}>
            La generación de seguimiento de frecuencia (Pulsos Binaurales) 
            requiere aislamiento estéreo estricto. El uso de altavoces externos 
            invalida el mecanismo neurológico.
          </p>
          
          <div style={{ background: '#111', padding: '16px', borderRadius: '8px', border: '1px solid #222', marginBottom: '32px', textAlign: 'left' }}>
            <div className="flex" style={{ gap: '10px', marginBottom: '8px' }}>
              <AlertTriangle size={16} style={{ color: '#ffcc00' }} />
              <span className="status-tag" style={{ color: '#eee' }}>Aviso de Seguridad</span>
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              El audio se genera en tiempo real. Ajusta el volumen al 30% antes de comenzar.
            </p>
          </div>

          <button onClick={() => setHeadphonesAcknowledged(true)} className="btn-primary w-full">
            Confirmo el uso de auriculares
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-col min-h-screen p-8">
      <div className="mx-auto w-full max-w-2xl">
        
        {/* Header Section */}
        <header className="text-center mb-8" style={{ marginTop: '20px' }}>
          <div className="flex-center mb-2" style={{ gap: '10px' }}>
            <Activity style={{ color: 'var(--accent-color)' }} size={24} />
            <h1 style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>
              Tracker & Synth DMN/TPN
            </h1>
          </div>
          <p className="status-tag">Enmascaramiento acústico e inducción de enfoque (15 min)</p>
        </header>

        {/* Central Timer Display */}
        <div className="rack-card text-center mb-8" style={{ padding: '48px 24px' }}>
          <div className="timer-display mb-4">
            {formatTime(elapsedTime)}
          </div>
          
          <div className="flex-center mb-8" style={{ gap: '8px' }}>
             <div className={`status-tag ${isPlaying ? 'status-active' : ''}`}>
               {isPlaying ? phaseText : "Sistema Inactivo"}
             </div>
          </div>

          <div className="flex-center">
            {isPlaying ? (
              <button onClick={togglePlay} className="btn-danger">
                <Square size={20} fill="currentColor" />
                Corte Abrupto (Hard Stop)
              </button>
            ) : (
              <button onClick={togglePlay} className="btn-primary" style={{ padding: '18px 48px' }}>
                <Play size={20} fill="currentColor" />
                Iniciar Sesión
              </button>
            )}
          </div>

          {/* Progress bar logic inside the rack card footer */}
          {isPlaying && (
            <div style={{ width: '100%', height: '2px', background: '#222', marginTop: '40px', borderRadius: '10px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  width: `${progressPercentage}%`, 
                  height: '100%', 
                  background: 'var(--accent-color)', 
                  boxShadow: '0 0 10px var(--accent-glow)',
                  transition: 'width 1s linear'
                }} 
              />
            </div>
          )}
        </div>

        {/* Synth & Mixer Grid */}
        <div className="grid-cols-2 mb-8">
          
          {/* Synth Panel */}
          <div className="rack-card">
            <h2 className="status-tag mb-8 flex" style={{ gap: '8px' }}>
              <SlidersHorizontal size={14} /> Sintetizador Binaural
            </h2>
            
            <div className="flex-col gap-4">
              <div>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Portadora</span>
                  <span style={{ color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>{carrierFreq} Hz</span>
                </div>
                <input 
                  type="range" min="100" max="500" 
                  value={carrierFreq} onChange={(e) => setCarrierFreq(Number(e.target.value))}
                  className="accent-slider text-emerald-500" 
                />
              </div>
              
              <div>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Diferencia</span>
                  <span style={{ color: 'var(--accent-color)', fontFamily: 'var(--font-mono)' }}>{beatFreq} Hz</span>
                </div>
                <input 
                  type="range" min="1" max="30" step="0.5" 
                  value={beatFreq} onChange={(e) => setBeatFreq(Number(e.target.value))}
                  className="accent-slider"
                />
              </div>
            </div>
          </div>

          {/* Mixer Panel */}
          <div className="rack-card">
            <h2 className="status-tag mb-8 flex" style={{ gap: '8px' }}>
              <Volume2 size={14} /> Mezclador
            </h2>
            
            <div className="flex-col gap-4">
              <div>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Pulso Binaural</span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{Math.round(binauralVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={binauralVol} onChange={(e) => setBinauralVol(Number(e.target.value))}
                />
              </div>
              
              <div>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Ruido Marrón</span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{Math.round(brownVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={brownVol} onChange={(e) => setBrownVol(Number(e.target.value))}
                />
              </div>

              <div style={{ paddingTop: '16px', borderTop: '1px solid #222' }}>
                <div className="flex" style={{ justifyContent: 'space-between', fontSize: '12px' }}>
                  <span className="flex" style={{ gap: '4px', color: 'var(--text-secondary)' }}><Volume2 size={12}/> Máster</span>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{Math.round(masterVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={masterVol} onChange={(e) => setMasterVol(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Analytics Card */}
        <div className="rack-card">
          <h2 className="status-tag mb-4 flex" style={{ gap: '8px' }}>
            <Brain size={14} /> Proyección Neurológica
          </h2>
          <div className="flex-col gap-4" style={{ fontSize: '13px' }}>
            <div className="flex" style={{ gap: '16px', paddingBottom: '12px', borderBottom: '1px solid #222' }}>
              <span style={{ color: '#555', fontFamily: 'var(--font-mono)', width: '100px', flexShrink: 0 }}>BINAURAL_FFR</span>
              <span style={{ color: '#aaa' }}>{currentAnalysis.binaural}</span>
            </div>
            <div className="flex" style={{ gap: '16px', paddingBottom: '12px', borderBottom: '1px solid #222' }}>
              <span style={{ color: '#555', fontFamily: 'var(--font-mono)', width: '100px', flexShrink: 0 }}>MASKING</span>
              <span style={{ color: '#aaa' }}>{currentAnalysis.masking}</span>
            </div>
            <div className="flex" style={{ gap: '16px' }}>
              <span style={{ color: '#555', fontFamily: 'var(--font-mono)', width: '100px', flexShrink: 0 }}>DMN_STATE</span>
              <span style={{ color: 'var(--accent-color)', opacity: 0.8 }}>{currentAnalysis.protocol}</span>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default App;
