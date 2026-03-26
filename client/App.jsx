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
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 text-neutral-200 font-sans">
        <div className="max-w-md w-full bg-neutral-800 p-8 rounded-lg border border-neutral-700 shadow-2xl">
          <div className="flex justify-center mb-6">
            <Headphones className="w-16 h-16 text-emerald-500" />
          </div>
          <h1 className="text-xl font-bold text-center mb-4 tracking-tight">Requisito de Hardware</h1>
          <p className="text-neutral-400 text-sm text-center mb-6 leading-relaxed">
            La generación de la respuesta de seguimiento de frecuencia (Pulsos Binaurales) 
            requiere un aislamiento acústico estricto en el dominio estéreo. 
            El uso de altavoces externos invalida el mecanismo neurológico.
          </p>
          <div className="bg-neutral-900 p-4 rounded text-xs text-neutral-500 mb-8 border border-neutral-800">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="font-semibold text-neutral-300">Aviso Crítico:</span>
            </div>
            La aplicación genera frecuencias algorítmicamente en tiempo real. Configura el volumen de tu dispositivo a un nivel seguro (~30%) antes de continuar.
          </div>
          <button 
            onClick={() => setHeadphonesAcknowledged(true)}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-3 px-4 rounded transition-colors"
          >
            Confirmo el uso de auriculares
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-200 font-sans p-4 sm:p-8 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        
        {/* Cabecera */}
        <header className="mb-10 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-neutral-100 flex items-center justify-center gap-2">
            <Activity className="w-6 h-6 text-emerald-500" />
            Tracker & Synth DMN/TPN
          </h1>
          <p className="text-neutral-500 text-sm mt-2">Enmascaramiento acústico e inducción de enfoque (Protocolo de 15 min)</p>
        </header>

        {/* Panel Principal: Control y Temporizador */}
        <div className="bg-neutral-800 rounded-xl p-8 border border-neutral-700 shadow-xl mb-6">
          
          <div className="flex flex-col items-center mb-8">
            <div className={`text-5xl font-mono font-light mb-2 transition-colors duration-500 ${isPlaying ? 'text-neutral-100' : 'text-neutral-600'}`}>
              {formatTime(elapsedTime)}
            </div>
            
            <div className={`text-xs font-semibold uppercase tracking-widest ${isPlaying ? phaseColor : 'text-neutral-600'}`}>
              {isPlaying ? phaseText : "Sistema Inactivo"}
            </div>
            
            {/* Barra de progreso de fricción (DMN) */}
            <div className="w-full h-1 bg-neutral-900 rounded-full mt-6 overflow-hidden">
              <div 
                className="h-full bg-emerald-500 transition-all duration-1000 ease-linear"
                style={{ width: `${isPlaying ? progressPercentage : 0}%`, opacity: isFrictionPhase ? 1 : 0.4 }}
              />
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={togglePlay}
              className={`flex items-center gap-3 px-8 py-4 rounded-lg font-bold uppercase tracking-wider transition-all shadow-lg ${
                isPlaying 
                  ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-900/20' 
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
              }`}
            >
              {isPlaying ? (
                <>
                  <Square className="w-5 h-5" fill="currentColor" />
                  Corte Abrupto (Hard Stop)
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" fill="currentColor" />
                  Iniciar Sesión
                </>
              )}
            </button>
          </div>
        </div>

        {/* Panel Secundario: Controles Sintetizador (Carga Cognitiva Reducida: Sin menús anidados) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Motor Binaural */}
          <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-6 flex items-center gap-2">
              <Activity className="w-4 h-4" /> Sintetizador Binaural
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Portadora</span>
                  <span className="font-mono text-emerald-500">{carrierFreq} Hz</span>
                </div>
                <input 
                  type="range" min="100" max="500" step="1" 
                  value={carrierFreq} onChange={(e) => setCarrierFreq(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-neutral-700 h-1 rounded-full appearance-none outline-none"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Diferencia (Pulsos)</span>
                  <span className="font-mono text-emerald-500">{beatFreq} Hz</span>
                </div>
                <input 
                  type="range" min="1" max="30" step="0.5" 
                  value={beatFreq} onChange={(e) => setBeatFreq(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-neutral-700 h-1 rounded-full appearance-none outline-none"
                />
              </div>
            </div>
          </div>

          {/* Mezclador Global */}
          <div className="bg-neutral-800 p-6 rounded-xl border border-neutral-700">
             <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-6 flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4" /> Mezclador
            </h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Pulso Binaural</span>
                  <span className="font-mono">{Math.round(binauralVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={binauralVol} onChange={(e) => setBinauralVol(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-neutral-700 h-1 rounded-full appearance-none outline-none"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span>Ruido Marrón (Enmascaramiento)</span>
                  <span className="font-mono">{Math.round(brownVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={brownVol} onChange={(e) => setBrownVol(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-neutral-700 h-1 rounded-full appearance-none outline-none"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-neutral-700">
                <div className="flex justify-between text-xs text-neutral-400">
                  <span className="flex items-center gap-1"><Volume2 className="w-3 h-3"/> Máster</span>
                  <span className="font-mono">{Math.round(masterVol * 100)}%</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={masterVol} onChange={(e) => setMasterVol(Number(e.target.value))}
                  className="w-full accent-neutral-400 bg-neutral-700 h-1 rounded-full appearance-none outline-none"
                />
              </div>
            </div>
          </div>

        </div>

        {/* Panel Terciario: Análisis Cognitivo */}
        <div className="mt-6 bg-neutral-800 p-6 rounded-xl border border-neutral-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-4 flex items-center gap-2">
            <Brain className="w-4 h-4" /> Proyección Neurológica
          </h2>
          <div className="space-y-4 text-sm">
            <div className="flex flex-col md:flex-row md:gap-4 border-b border-neutral-700 pb-3">
              <span className="text-neutral-500 font-mono w-32 shrink-0">BINAURAL_FFR</span>
              <span className="text-neutral-300">{currentAnalysis.binaural}</span>
            </div>
            <div className="flex flex-col md:flex-row md:gap-4 border-b border-neutral-700 pb-3">
              <span className="text-neutral-500 font-mono w-32 shrink-0">ENMASCARAR</span>
              <span className="text-neutral-300">{currentAnalysis.masking}</span>
            </div>
            <div className="flex flex-col md:flex-row md:gap-4">
              <span className="text-neutral-500 font-mono w-32 shrink-0">ESTADO_DMN</span>
              <span className="text-emerald-500/90">{currentAnalysis.protocol}</span>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default App;
